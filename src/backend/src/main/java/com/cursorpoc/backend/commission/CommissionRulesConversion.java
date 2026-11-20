package com.cursorpoc.backend.commission;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * HU-COM-20: converts the commission rules that exist to the simpler model, once (it runs from the
 * Flyway migration V101). It uses plain JDBC with standard SQL so it works on SQL Server and on H2.
 *
 * <ul>
 *   <li>The retention that a rule carried ({@code pago|retención|fijo|destino}) is folded into the
 *       %: the rule's % is now the whole commission (45 + 5 = 50) and the retention is the
 *       professional's. Only for salons that retain for aguinaldo; otherwise the retention was not
 *       applied and it is just dropped (what is paid does not change).
 *   <li>A professional that retained through her rules but has no retention % of her own gets one:
 *       the most frequent retention among her rules.
 *   <li>The rules of a professional in a group are copied, one per service the group has today, to
 *       rules of the professional for that service (unless she already has one there); the group
 *       rules of a professional are cancelled (kept in the history, no longer applied).
 * </ul>
 */
public final class CommissionRulesConversion {

  /** What the conversion did, for the log and for the tests. */
  public record Result(
      int foldedValues,
      int professionalsWithNewRetention,
      int expandedRules,
      int retiredGroupRules) {}

  private record Version(
      long id,
      long tenantId,
      String scope,
      Long serviceId,
      Long professionalId,
      Long groupId,
      String value,
      Timestamp effectiveFrom,
      String applyMode,
      String status,
      Long recalculationId,
      Timestamp createdAt,
      String createdBy) {}

  private static final String COLUMNS =
      "id, tenant_id, scope, service_id, professional_id, group_id, config_value, effective_from,"
          + " apply_mode, status, recalculation_id, created_at, created_by_email";

  private CommissionRulesConversion() {}

  public static Result convert(Connection c) throws SQLException {
    List<Version> all = new ArrayList<>();
    try (PreparedStatement ps =
            c.prepareStatement(
                "SELECT "
                    + COLUMNS
                    + " FROM commission_config_versions WHERE scope IN"
                    + " ('RULE','GROUP_RULE','RETENTION_PROFILE','AGUINALDO_ENABLED')"
                    + " ORDER BY tenant_id, id");
        ResultSet rs = ps.executeQuery()) {
      while (rs.next()) {
        all.add(
            new Version(
                rs.getLong(1),
                rs.getLong(2),
                rs.getString(3),
                nullableLong(rs, 4),
                nullableLong(rs, 5),
                nullableLong(rs, 6),
                rs.getString(7),
                rs.getTimestamp(8),
                rs.getString(9),
                rs.getString(10),
                nullableLong(rs, 11),
                rs.getTimestamp(12),
                rs.getString(13)));
      }
    }
    Map<Long, List<Version>> byTenant = new TreeMap<>();
    for (Version v : all) {
      byTenant.computeIfAbsent(v.tenantId(), k -> new ArrayList<>()).add(v);
    }
    int folded = 0;
    int profiles = 0;
    int expanded = 0;
    int retired = 0;
    Timestamp now = Timestamp.from(Instant.now());
    for (Map.Entry<Long, List<Version>> tenant : byTenant.entrySet()) {
      long tenantId = tenant.getKey();
      List<Version> versions = tenant.getValue();
      boolean aguinaldo = aguinaldoEnabled(versions, now);

      // 1 · fold the retention of every rule into its %; remember what each professional retained.
      Map<Long, List<BigDecimal>> retained = new HashMap<>();
      Map<Long, Timestamp> retainedSince = new HashMap<>();
      Map<Long, String> newValues = new HashMap<>();
      for (Version v : versions) {
        if (!isRule(v) || v.value() == null || !v.value().contains("|")) {
          continue;
        }
        Parsed p = Parsed.of(v.value());
        BigDecimal total =
            aguinaldo ? p.percent().add(p.retention()).min(BigDecimal.valueOf(100)) : p.percent();
        String converted =
            new Parsed(total, BigDecimal.ZERO, p.fixed(), p.destination()).serialize();
        if (!converted.equals(v.value())) {
          update(
              c,
              "UPDATE commission_config_versions SET config_value = ? WHERE id = ?",
              converted,
              v.id());
          newValues.put(v.id(), converted);
          folded++;
        }
        if (aguinaldo
            && p.retention().signum() > 0
            && "ACTIVE".equals(v.status())
            && v.professionalId() != null) {
          retained.computeIfAbsent(v.professionalId(), k -> new ArrayList<>()).add(p.retention());
          retainedSince.merge(v.professionalId(), v.effectiveFrom(), (a, b) -> a.before(b) ? a : b);
        }
      }

      // 2 · a professional that retained through her rules and has no retention of her own.
      for (Map.Entry<Long, List<BigDecimal>> e : retained.entrySet()) {
        long professionalId = e.getKey();
        Version latestProfile = latest(versions, "RETENTION_PROFILE", null, professionalId, null);
        boolean hasProfile =
            latestProfile != null
                && latestProfile.value() != null
                && new BigDecimal(latestProfile.value().trim()).signum() > 0;
        if (hasProfile) {
          continue;
        }
        BigDecimal chosen = mostFrequent(e.getValue());
        Timestamp since = retainedSince.get(professionalId);
        if (latestProfile != null && latestProfile.effectiveFrom().after(since)) {
          since = latestProfile.effectiveFrom();
        }
        insert(
            c,
            tenantId,
            "RETENTION_PROFILE",
            null,
            professionalId,
            null,
            chosen.setScale(2, RoundingMode.HALF_UP).toPlainString(),
            since,
            "IMMEDIATE",
            now,
            "migration");
        profiles++;
      }

      // 3 · rules of a professional in a group → rules of the professional for each service.
      Map<Long, List<Long>> servicesOfGroup = new HashMap<>();
      try (PreparedStatement ps =
          c.prepareStatement(
              "SELECT id, commission_group_id FROM services WHERE tenant_id = ? AND"
                  + " commission_group_id IS NOT NULL AND active = ?"); ) {
        ps.setLong(1, tenantId);
        ps.setBoolean(2, true);
        try (ResultSet rs = ps.executeQuery()) {
          while (rs.next()) {
            servicesOfGroup
                .computeIfAbsent(rs.getLong(2), k -> new ArrayList<>())
                .add(rs.getLong(1));
          }
        }
      }
      Set<String> hasServiceRule = new HashSet<>();
      for (Version v : versions) {
        if ("RULE".equals(v.scope()) && "ACTIVE".equals(v.status()) && v.professionalId() != null) {
          hasServiceRule.add(v.serviceId() + ":" + v.professionalId());
        }
      }
      List<Version> groupRules =
          versions.stream()
              .filter(
                  v ->
                      "GROUP_RULE".equals(v.scope())
                          && "ACTIVE".equals(v.status())
                          && v.professionalId() != null
                          && v.groupId() != null)
              .sorted(Comparator.comparing(Version::id))
              .toList();
      for (Version rule : groupRules) {
        String value = newValues.getOrDefault(rule.id(), rule.value());
        for (long serviceId : servicesOfGroup.getOrDefault(rule.groupId(), List.of())) {
          if (hasServiceRule.contains(serviceId + ":" + rule.professionalId())) {
            continue;
          }
          insert(
              c,
              tenantId,
              "RULE",
              serviceId,
              rule.professionalId(),
              null,
              value,
              rule.effectiveFrom(),
              rule.applyMode(),
              rule.createdAt(),
              rule.createdBy());
          expanded++;
        }
      }
      // the services that received the timeline are now covered; retire the group rules.
      for (Version rule : groupRules) {
        try (PreparedStatement ps =
            c.prepareStatement(
                "UPDATE commission_config_versions SET status = 'CANCELLED', cancelled_at = ?,"
                    + " cancelled_by_email = 'migration' WHERE id = ?")) {
          ps.setTimestamp(1, now);
          ps.setLong(2, rule.id());
          ps.executeUpdate();
        }
        retired++;
      }
    }
    return new Result(folded, profiles, expanded, retired);
  }

  private static boolean isRule(Version v) {
    return "RULE".equals(v.scope()) || "GROUP_RULE".equals(v.scope());
  }

  private static boolean aguinaldoEnabled(List<Version> versions, Timestamp now) {
    Version latest = null;
    for (Version v : versions) {
      if ("AGUINALDO_ENABLED".equals(v.scope())
          && "ACTIVE".equals(v.status())
          && !v.effectiveFrom().after(now)
          && (latest == null
              || v.effectiveFrom().after(latest.effectiveFrom())
              || (v.effectiveFrom().equals(latest.effectiveFrom()) && v.id() > latest.id()))) {
        latest = v;
      }
    }
    return latest != null && "true".equalsIgnoreCase(latest.value());
  }

  private static Version latest(
      List<Version> versions, String scope, Long serviceId, Long professionalId, Long groupId) {
    Version latest = null;
    for (Version v : versions) {
      if (scope.equals(v.scope())
          && "ACTIVE".equals(v.status())
          && java.util.Objects.equals(v.serviceId(), serviceId)
          && java.util.Objects.equals(v.professionalId(), professionalId)
          && java.util.Objects.equals(v.groupId(), groupId)
          && (latest == null
              || v.effectiveFrom().after(latest.effectiveFrom())
              || (v.effectiveFrom().equals(latest.effectiveFrom()) && v.id() > latest.id()))) {
        latest = v;
      }
    }
    return latest;
  }

  private static BigDecimal mostFrequent(List<BigDecimal> values) {
    Map<BigDecimal, Integer> counts = new HashMap<>();
    for (BigDecimal v : values) {
      counts.merge(v.stripTrailingZeros(), 1, Integer::sum);
    }
    return counts.entrySet().stream()
        .max(
            Map.Entry.<BigDecimal, Integer>comparingByValue()
                .thenComparing(Map.Entry.comparingByKey()))
        .orElseThrow()
        .getKey();
  }

  private static Long nullableLong(ResultSet rs, int i) throws SQLException {
    long v = rs.getLong(i);
    return rs.wasNull() ? null : v;
  }

  private static void update(Connection c, String sql, String value, long id) throws SQLException {
    try (PreparedStatement ps = c.prepareStatement(sql)) {
      ps.setString(1, value);
      ps.setLong(2, id);
      ps.executeUpdate();
    }
  }

  private static void insert(
      Connection c,
      long tenantId,
      String scope,
      Long serviceId,
      Long professionalId,
      Long groupId,
      String value,
      Timestamp effectiveFrom,
      String applyMode,
      Timestamp createdAt,
      String createdBy)
      throws SQLException {
    try (PreparedStatement ps =
        c.prepareStatement(
            "INSERT INTO commission_config_versions (tenant_id, scope, service_id, professional_id,"
                + " group_id, config_value, effective_from, apply_mode, status, created_at,"
                + " created_by_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)")) {
      ps.setLong(1, tenantId);
      ps.setString(2, scope);
      setLong(ps, 3, serviceId);
      setLong(ps, 4, professionalId);
      setLong(ps, 5, groupId);
      ps.setString(6, value);
      ps.setTimestamp(7, effectiveFrom);
      ps.setString(8, applyMode);
      ps.setTimestamp(9, createdAt);
      ps.setString(10, createdBy);
      ps.executeUpdate();
    }
  }

  private static void setLong(PreparedStatement ps, int i, Long v) throws SQLException {
    if (v == null) {
      ps.setNull(i, java.sql.Types.BIGINT);
    } else {
      ps.setLong(i, v);
    }
  }

  /** The four parts of a stored rule value, tolerant of the plain "45" format. */
  private record Parsed(
      BigDecimal percent, BigDecimal retention, BigDecimal fixed, String destination) {

    static Parsed of(String raw) {
      String[] parts = raw.split("\\|", -1);
      return new Parsed(
          number(parts[0]),
          parts.length > 1 ? number(parts[1]) : BigDecimal.ZERO,
          parts.length > 2 ? number(parts[2]) : BigDecimal.ZERO,
          parts.length > 3 ? parts[3].trim() : "");
    }

    private static BigDecimal number(String s) {
      return s == null || s.isBlank()
          ? BigDecimal.ZERO
          : new BigDecimal(s.trim().replace(',', '.'));
    }

    String serialize() {
      String pct = percent.setScale(2, RoundingMode.HALF_UP).toPlainString();
      if (fixed.signum() == 0 && destination.isEmpty()) {
        return pct;
      }
      return pct + "|0.00|" + fixed.stripTrailingZeros().toPlainString() + "|" + destination;
    }
  }
}
