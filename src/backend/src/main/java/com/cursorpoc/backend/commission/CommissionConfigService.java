package com.cursorpoc.backend.commission;

import com.cursorpoc.backend.commission.CommissionConfigSnapshot.ScopeKey;
import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.CommissionConfigVersion;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.enums.CommissionApplyMode;
import com.cursorpoc.backend.domain.enums.CommissionBaseType;
import com.cursorpoc.backend.domain.enums.CommissionConfigScope;
import com.cursorpoc.backend.domain.enums.CommissionPeriodicity;
import com.cursorpoc.backend.domain.enums.CommissionVersionStatus;
import com.cursorpoc.backend.domain.enums.ServiceKind;
import com.cursorpoc.backend.repository.CommissionConfigVersionRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.web.dto.CommissionDtos.ApplyChangesRequest;
import com.cursorpoc.backend.web.dto.CommissionDtos.ApplyChangesResponse;
import com.cursorpoc.backend.web.dto.CommissionDtos.ApplyModeOptions;
import com.cursorpoc.backend.web.dto.CommissionDtos.ConfigChange;
import com.cursorpoc.backend.web.dto.CommissionDtos.ExceptionView;
import com.cursorpoc.backend.web.dto.CommissionDtos.ItemRulesResponse;
import com.cursorpoc.backend.web.dto.CommissionDtos.ItemWithoutRule;
import com.cursorpoc.backend.web.dto.CommissionDtos.PeriodInfo;
import com.cursorpoc.backend.web.dto.CommissionDtos.ProfessionalAmount;
import com.cursorpoc.backend.web.dto.CommissionDtos.RecalculationPreview;
import com.cursorpoc.backend.web.dto.CommissionDtos.RuleCategory;
import com.cursorpoc.backend.web.dto.CommissionDtos.RuleException;
import com.cursorpoc.backend.web.dto.CommissionDtos.RuleItem;
import com.cursorpoc.backend.web.dto.CommissionDtos.RuleProfessional;
import com.cursorpoc.backend.web.dto.CommissionDtos.RulesView;
import com.cursorpoc.backend.web.dto.CommissionDtos.SettingsResponse;
import com.cursorpoc.backend.web.dto.CommissionDtos.VersionView;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.interceptor.TransactionAspectSupport;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-COM-01 (settings), HU-COM-02 (rules), HU-COM-09 (mid-period changes): every change becomes a
 * new version with an {@code effectiveFrom} chosen through the apply mode.
 */
@Service
public class CommissionConfigService {

  private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);

  private final CommissionConfigVersionRepository versionRepository;
  private final SalonServiceRepository serviceRepository;
  private final ProfessionalRepository professionalRepository;
  private final CommissionLedger ledger;
  private final CommissionRecalculationService recalculationService;
  private final FemmeTimeProperties timeProperties;

  public CommissionConfigService(
      CommissionConfigVersionRepository versionRepository,
      SalonServiceRepository serviceRepository,
      ProfessionalRepository professionalRepository,
      CommissionLedger ledger,
      CommissionRecalculationService recalculationService,
      FemmeTimeProperties timeProperties) {
    this.versionRepository = versionRepository;
    this.serviceRepository = serviceRepository;
    this.professionalRepository = professionalRepository;
    this.ledger = ledger;
    this.recalculationService = recalculationService;
    this.timeProperties = timeProperties;
  }

  public ZoneId zone() {
    return timeProperties.zoneId();
  }

  // ── Periods ───────────────────────────────────────────────────────────────────────────────

  public PeriodInfo currentPeriod(CommissionConfigSnapshot snapshot, Instant now) {
    CommissionPeriodicity periodicity = snapshot.periodicityAt(now);
    LocalDate today = LocalDate.ofInstant(now, zone());
    CommissionPeriods.Period p = CommissionPeriods.periodContaining(periodicity, today);
    CommissionPeriods.Period next = CommissionPeriods.nextPeriod(periodicity, today);
    return new PeriodInfo(
        periodicity.name(),
        p == null ? null : p.from(),
        p == null ? null : p.to(),
        next == null ? null : next.from());
  }

  @Transactional(readOnly = true)
  public ApplyModeOptions applyModeOptions(long tenantId) {
    CommissionConfigSnapshot snapshot = ledger.snapshot(tenantId);
    Instant now = Instant.now();
    PeriodInfo period = currentPeriod(snapshot, now);
    boolean manual = CommissionPeriodicity.MANUAL.name().equals(period.periodicity());
    Instant periodStart =
        manual
            ? recalculationService.earliestOpenAccrual(tenantId, now)
            : period.from().atStartOfDay(zone()).toInstant();
    List<String> modes =
        manual
            ? List.of(CommissionApplyMode.IMMEDIATE.name(), CommissionApplyMode.PERIOD_START.name())
            : List.of(
                CommissionApplyMode.IMMEDIATE.name(),
                CommissionApplyMode.NEXT_PERIOD.name(),
                CommissionApplyMode.PERIOD_START.name());
    return new ApplyModeOptions(
        period,
        now,
        manual ? null : period.nextFrom().atStartOfDay(zone()).toInstant(),
        periodStart,
        modes);
  }

  // ── Changes ───────────────────────────────────────────────────────────────────────────────

  @Transactional
  public ApplyChangesResponse applyChanges(
      long tenantId, String actorEmail, ApplyChangesRequest request) {
    if (request == null || request.changes() == null || request.changes().isEmpty()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "COMMISSION_CHANGES_REQUIRED");
    }
    CommissionConfigSnapshot snapshot = ledger.snapshot(tenantId);
    Instant now = Instant.now();
    boolean onlyPeriodicity =
        request.changes().stream()
            .allMatch(c -> CommissionConfigScope.PERIODICITY.name().equals(c.scope()));

    CommissionApplyMode mode;
    Instant effectiveFrom;
    if (onlyPeriodicity) {
      // C13: periodicity does not change the calculation — no question, applies to new settlements.
      mode = CommissionApplyMode.IMMEDIATE;
      effectiveFrom = now;
    } else {
      mode = parseMode(request.applyMode());
      ApplyModeOptions options = applyModeOptions(tenantId);
      if (!options.availableModes().contains(mode.name())) {
        throw new ResponseStatusException(
            HttpStatus.BAD_REQUEST, "COMMISSION_APPLY_MODE_NOT_AVAILABLE");
      }
      effectiveFrom =
          switch (mode) {
            case IMMEDIATE -> now;
            case NEXT_PERIOD -> options.nextPeriodFrom();
            case PERIOD_START -> options.periodStartFrom();
          };
    }

    List<ScopeKey> keys = new ArrayList<>();
    for (ConfigChange change : request.changes()) {
      CommissionConfigScope scope = parseScope(change.scope());
      String value = validateValue(tenantId, scope, change);
      ScopeKey key =
          scope == CommissionConfigScope.RULE
              ? ScopeKey.rule(change.serviceId(), change.professionalId())
              : ScopeKey.of(scope);
      keys.add(key);

      List<CommissionConfigVersion> pending = snapshot.scheduledAfter(key, now);
      if (!pending.isEmpty()) {
        if (!request.replacePending()) {
          throw new ResponseStatusException(
              HttpStatus.CONFLICT, "COMMISSION_PENDING_CHANGE_EXISTS");
        }
        for (CommissionConfigVersion p : pending) {
          p.setStatus(CommissionVersionStatus.CANCELLED);
          p.setCancelledAt(now);
          p.setCancelledByEmail(actorEmail);
        }
      }
      if (mode == CommissionApplyMode.PERIOD_START) {
        // §4.4 rule 6: the new value replaces every version that ruled inside the period.
        for (CommissionConfigVersion v : snapshot.timelines().getOrDefault(key, List.of())) {
          if (!v.getEffectiveFrom().isBefore(effectiveFrom) && !v.getEffectiveFrom().isAfter(now)) {
            v.setStatus(CommissionVersionStatus.SUPERSEDED);
          }
        }
      }
      versionRepository.save(newVersion(tenantId, key, value, effectiveFrom, mode, actorEmail));
      if (change.validUntil() != null) {
        if (scope != CommissionConfigScope.RULE) {
          throw new ResponseStatusException(
              HttpStatus.BAD_REQUEST, "COMMISSION_VALID_UNTIL_INVALID");
        }
        Instant closeAt = change.validUntil().plusDays(1).atStartOfDay(zone()).toInstant();
        if (!closeAt.isAfter(effectiveFrom)) {
          throw new ResponseStatusException(
              HttpStatus.BAD_REQUEST, "COMMISSION_VALID_UNTIL_INVALID");
        }
        versionRepository.save(
            newVersion(tenantId, key, null, closeAt, CommissionApplyMode.NEXT_PERIOD, actorEmail));
      }
    }

    RecalculationPreview recalculation = null;
    if (mode == CommissionApplyMode.PERIOD_START) {
      versionRepository.flush();
      CommissionRecalculationService.Stats stats =
          recalculationService.recalculate(tenantId, keys, effectiveFrom, actorEmail);
      Map<Long, String> names = professionalNames(tenantId);
      recalculation =
          new RecalculationPreview(
              stats.entriesRecalculated(),
              stats.entriesExcluded(),
              stats.deltaAmount(),
              stats.deltaByProfessional().entrySet().stream()
                  .map(e -> new ProfessionalAmount(e.getKey(), names.get(e.getKey()), e.getValue()))
                  .toList());
    }
    if (request.preview()) {
      // The preview runs the exact same logic and is rolled back (nothing persists).
      TransactionAspectSupport.currentTransactionStatus().setRollbackOnly();
    }
    return new ApplyChangesResponse(mode.name(), effectiveFrom, request.preview(), recalculation);
  }

  @Transactional
  public void cancelScheduled(long tenantId, long versionId, String actorEmail) {
    CommissionConfigVersion v =
        versionRepository
            .findById(versionId)
            .filter(x -> x.getTenantId() == tenantId)
            .orElseThrow(
                () ->
                    new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "COMMISSION_PENDING_CHANGE_NOT_FOUND"));
    if (v.getStatus() != CommissionVersionStatus.ACTIVE) {
      throw new ResponseStatusException(
          HttpStatus.NOT_FOUND, "COMMISSION_PENDING_CHANGE_NOT_FOUND");
    }
    if (!v.getEffectiveFrom().isAfter(Instant.now())) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "COMMISSION_PENDING_CHANGE_ALREADY_EFFECTIVE");
    }
    v.setStatus(CommissionVersionStatus.CANCELLED);
    v.setCancelledAt(Instant.now());
    v.setCancelledByEmail(actorEmail);
  }

  /** e2e support: scheduled changes of the tenant take effect now (simulates the date arriving). */
  @Transactional
  public int makeScheduledEffectiveNow(long tenantId) {
    Instant now = Instant.now();
    int count = 0;
    for (CommissionConfigVersion v :
        versionRepository.findByTenantIdAndStatus(tenantId, CommissionVersionStatus.ACTIVE)) {
      if (v.getEffectiveFrom().isAfter(now)) {
        v.setEffectiveFrom(now);
        count++;
      }
    }
    return count;
  }

  private CommissionConfigVersion newVersion(
      long tenantId,
      ScopeKey key,
      String value,
      Instant effectiveFrom,
      CommissionApplyMode mode,
      String actorEmail) {
    CommissionConfigVersion v = new CommissionConfigVersion();
    v.setTenantId(tenantId);
    v.setScope(key.scope());
    v.setServiceId(key.serviceId());
    v.setProfessionalId(key.professionalId());
    v.setConfigValue(value);
    v.setEffectiveFrom(effectiveFrom);
    v.setApplyMode(mode);
    v.setStatus(CommissionVersionStatus.ACTIVE);
    v.setCreatedAt(Instant.now());
    v.setCreatedByEmail(actorEmail);
    return v;
  }

  private String validateValue(long tenantId, CommissionConfigScope scope, ConfigChange change) {
    String raw = change.value() == null ? null : change.value().trim();
    switch (scope) {
      case BASE -> {
        try {
          return CommissionBaseType.valueOf(raw).name();
        } catch (RuntimeException e) {
          throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "COMMISSION_BASE_INVALID");
        }
      }
      case PERIODICITY -> {
        try {
          return CommissionPeriodicity.valueOf(raw).name();
        } catch (RuntimeException e) {
          throw new ResponseStatusException(
              HttpStatus.BAD_REQUEST, "COMMISSION_PERIODICITY_INVALID");
        }
      }
      case DEFAULT_SERVICE, DEFAULT_PRODUCT -> {
        return parsePercent(raw).toPlainString();
      }
      case RULE -> {
        if (change.serviceId() == null) {
          throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SERVICE_NOT_FOUND");
        }
        serviceRepository
            .findByIdAndTenant_Id(change.serviceId(), tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "SERVICE_NOT_FOUND"));
        if (change.professionalId() != null) {
          Professional p =
              professionalRepository
                  .findByIdAndTenant_Id(change.professionalId(), tenantId)
                  .orElseThrow(
                      () ->
                          new ResponseStatusException(
                              HttpStatus.NOT_FOUND, "PROFESSIONAL_NOT_FOUND"));
          if (raw != null && !raw.isEmpty() && !p.isActive()) {
            throw new ResponseStatusException(
                HttpStatus.CONFLICT, "COMMISSION_PROFESSIONAL_INACTIVE");
          }
        }
        return raw == null || raw.isEmpty() ? null : parsePercent(raw).toPlainString();
      }
      default ->
          throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "COMMISSION_SCOPE_INVALID");
    }
  }

  static BigDecimal parsePercent(String raw) {
    try {
      BigDecimal p = new BigDecimal(raw.replace(',', '.'));
      if (p.signum() < 0 || p.compareTo(HUNDRED) > 0 || p.stripTrailingZeros().scale() > 2) {
        throw new NumberFormatException();
      }
      return p.setScale(2, java.math.RoundingMode.UNNECESSARY);
    } catch (RuntimeException e) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "COMMISSION_PERCENT_OUT_OF_RANGE");
    }
  }

  private static CommissionApplyMode parseMode(String raw) {
    if (raw == null || raw.isBlank()) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "COMMISSION_CHANGE_APPLY_MODE_REQUIRED");
    }
    try {
      return CommissionApplyMode.valueOf(raw);
    } catch (IllegalArgumentException e) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "COMMISSION_CHANGE_APPLY_MODE_REQUIRED");
    }
  }

  private static CommissionConfigScope parseScope(String raw) {
    try {
      return CommissionConfigScope.valueOf(raw);
    } catch (RuntimeException e) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "COMMISSION_SCOPE_INVALID");
    }
  }

  // ── Read models ───────────────────────────────────────────────────────────────────────────

  @Transactional(readOnly = true)
  public SettingsResponse settings(long tenantId) {
    CommissionConfigSnapshot snapshot = ledger.snapshot(tenantId);
    Instant now = Instant.now();
    Lookups lookups = lookups(tenantId);
    List<VersionView> scheduled =
        snapshot.timelines().values().stream()
            .flatMap(List::stream)
            .filter(v -> v.getEffectiveFrom().isAfter(now))
            .sorted(Comparator.comparing(CommissionConfigVersion::getEffectiveFrom))
            .map(v -> view(v, snapshot, lookups, now))
            .toList();
    List<VersionView> history =
        versionRepository.findByTenantIdOrderByCreatedAtDescIdDesc(tenantId).stream()
            .limit(200)
            .map(v -> view(v, snapshot, lookups, now))
            .toList();
    return new SettingsResponse(
        snapshot.baseAt(now).name(),
        snapshot.defaultPercentAt(CommissionConfigScope.DEFAULT_SERVICE, now),
        snapshot.defaultPercentAt(CommissionConfigScope.DEFAULT_PRODUCT, now),
        snapshot.periodicityAt(now).name(),
        currentPeriod(snapshot, now),
        scheduled,
        history);
  }

  @Transactional(readOnly = true)
  public ItemRulesResponse itemRules(long tenantId, long serviceId) {
    SalonService item =
        serviceRepository
            .findByIdAndTenant_Id(serviceId, tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "SERVICE_NOT_FOUND"));
    CommissionConfigSnapshot snapshot = ledger.snapshot(tenantId);
    Instant now = Instant.now();
    Lookups lookups = lookups(tenantId);
    Optional<CommissionConfigVersion> general = snapshot.ruleAt(serviceId, null, now);
    Set<Long> professionalIds = new LinkedHashSet<>();
    snapshot.timelines().keySet().stream()
        .filter(
            k ->
                k.scope() == CommissionConfigScope.RULE
                    && Objects.equals(k.serviceId(), serviceId)
                    && k.professionalId() != null)
        .forEach(k -> professionalIds.add(k.professionalId()));
    List<ExceptionView> exceptions = new ArrayList<>();
    for (Long pid : professionalIds) {
      Optional<CommissionConfigVersion> current = snapshot.ruleAt(serviceId, pid, now);
      List<VersionView> scheduled =
          snapshot.scheduledAfter(ScopeKey.rule(serviceId, pid), now).stream()
              .map(v -> view(v, snapshot, lookups, now))
              .toList();
      if (current.isEmpty() && scheduled.isEmpty()) {
        continue;
      }
      Professional p = lookups.professionals().get(pid);
      exceptions.add(
          new ExceptionView(
              pid,
              p == null ? null : p.getFullName(),
              p != null && p.isActive(),
              current.map(v -> new BigDecimal(v.getConfigValue())).orElse(null),
              current.map(CommissionConfigVersion::getId).orElse(null),
              scheduled));
    }
    exceptions.sort(
        Comparator.comparing(e -> e.professionalName() == null ? "" : e.professionalName()));
    List<VersionView> history =
        versionRepository.findByTenantIdOrderByCreatedAtDescIdDesc(tenantId).stream()
            .filter(
                v ->
                    v.getScope() == CommissionConfigScope.RULE
                        && Objects.equals(v.getServiceId(), serviceId))
            .map(v -> view(v, snapshot, lookups, now))
            .toList();
    CommissionConfigScope defaultScope =
        item.getKind() == ServiceKind.PRODUCT
            ? CommissionConfigScope.DEFAULT_PRODUCT
            : CommissionConfigScope.DEFAULT_SERVICE;
    return new ItemRulesResponse(
        serviceId,
        item.getName(),
        item.getKind().name(),
        general.map(v -> new BigDecimal(v.getConfigValue())).orElse(null),
        general.map(CommissionConfigVersion::getId).orElse(null),
        snapshot.defaultPercentAt(defaultScope, now),
        snapshot.scheduledAfter(ScopeKey.rule(serviceId, null), now).stream()
            .map(v -> view(v, snapshot, lookups, now))
            .toList(),
        exceptions,
        history);
  }

  /**
   * HU-COM-02 rules view: active items of one kind grouped (visually) by category, each with its
   * standard % (own item rule, or the general % of its kind) and the per-professional exceptions in
   * force at {@code date} (today by default).
   */
  @Transactional(readOnly = true)
  public RulesView rulesView(long tenantId, String kindRaw, LocalDate date) {
    ServiceKind kind;
    try {
      kind =
          kindRaw == null || kindRaw.isBlank() ? ServiceKind.SERVICE : ServiceKind.valueOf(kindRaw);
    } catch (IllegalArgumentException e) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "COMMISSION_SCOPE_INVALID");
    }
    LocalDate day = date != null ? date : LocalDate.now(zone());
    Instant now = Instant.now();
    Instant at =
        day.equals(LocalDate.now(zone()))
            ? now
            : day.plusDays(1).atStartOfDay(zone()).toInstant().minusMillis(1);
    CommissionConfigSnapshot snapshot = ledger.snapshot(tenantId);
    CommissionBaseType baseType = snapshot.baseAt(at);
    BigDecimal general =
        snapshot.defaultPercentAt(
            kind == ServiceKind.PRODUCT
                ? CommissionConfigScope.DEFAULT_PRODUCT
                : CommissionConfigScope.DEFAULT_SERVICE,
            at);
    List<Professional> professionals =
        professionalRepository.findByTenant_IdOrderByFullNameAsc(tenantId).stream()
            .filter(Professional::isActive)
            .toList();
    Map<Long, RuleCategoryBuilder> categories = new java.util.LinkedHashMap<>();
    int itemCount = 0;
    int withExceptions = 0;
    List<SalonService> items =
        serviceRepository.findByTenant_IdAndActiveTrueOrderByNameAsc(tenantId).stream()
            .filter(s -> s.getKind() == kind)
            .sorted(
                Comparator.comparing((SalonService s) -> s.getCategory().getName())
                    .thenComparing(SalonService::getName))
            .toList();
    for (SalonService s : items) {
      Optional<CommissionConfigVersion> own = snapshot.ruleAt(s.getId(), null, at);
      BigDecimal standard = own.map(v -> new BigDecimal(v.getConfigValue())).orElse(general);
      List<RuleException> exceptions = new ArrayList<>();
      for (Professional p : professionals) {
        snapshot
            .ruleAt(s.getId(), p.getId(), at)
            .ifPresent(
                v -> {
                  BigDecimal pct = new BigDecimal(v.getConfigValue());
                  exceptions.add(
                      new RuleException(p.getId(), p.getFullName(), pct, pct.subtract(standard)));
                });
      }
      boolean scheduled =
          snapshot.timelines().keySet().stream()
              .filter(
                  k ->
                      k.scope() == CommissionConfigScope.RULE
                          && Objects.equals(k.serviceId(), s.getId()))
              .anyMatch(k -> !snapshot.scheduledAfter(k, at).isEmpty());
      BigDecimal price = s.getPriceMinor() == null ? BigDecimal.ZERO : s.getPriceMinor();
      BigDecimal rate = s.getTax() != null ? s.getTax().getRate() : BigDecimal.ZERO;
      BigDecimal base =
          baseType == CommissionBaseType.NET_OF_TAX
              ? price.subtract(CommissionCalculator.includedTax(price, rate))
              : price;
      RuleItem item =
          new RuleItem(
              s.getId(),
              s.getName(),
              price,
              base.setScale(0, java.math.RoundingMode.HALF_UP),
              standard,
              own.isPresent(),
              exceptions,
              scheduled);
      itemCount++;
      boolean hasException = own.isPresent() || !exceptions.isEmpty();
      if (hasException) {
        withExceptions++;
      }
      categories
          .computeIfAbsent(
              s.getCategory().getId(), id -> new RuleCategoryBuilder(id, s.getCategory().getName()))
          .add(item, hasException);
    }
    return new RulesView(
        kind.name(),
        day,
        baseType.name(),
        general,
        itemCount,
        withExceptions,
        professionals.stream().map(p -> new RuleProfessional(p.getId(), p.getFullName())).toList(),
        categories.values().stream().map(RuleCategoryBuilder::build).toList());
  }

  private static final class RuleCategoryBuilder {
    private final Long id;
    private final String name;
    private final List<RuleItem> items = new ArrayList<>();
    private int exceptions;

    RuleCategoryBuilder(Long id, String name) {
      this.id = id;
      this.name = name;
    }

    void add(RuleItem item, boolean hasException) {
      items.add(item);
      if (hasException) {
        exceptions++;
      }
    }

    RuleCategory build() {
      return new RuleCategory(id, name, exceptions, items);
    }
  }

  /** HU-COM-02 / HU-COM-08: active items whose general percent is not defined. */
  @Transactional(readOnly = true)
  public List<ItemWithoutRule> itemsWithoutGeneralRule(long tenantId) {
    CommissionConfigSnapshot snapshot = ledger.snapshot(tenantId);
    Instant now = Instant.now();
    return serviceRepository.findByTenant_IdAndActiveTrueOrderByNameAsc(tenantId).stream()
        .filter(s -> snapshot.ruleAt(s.getId(), null, now).isEmpty())
        .map(s -> new ItemWithoutRule(s.getId(), s.getName(), s.getKind().name()))
        .toList();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────────────────

  record Lookups(Map<Long, SalonService> services, Map<Long, Professional> professionals) {}

  Lookups lookups(long tenantId) {
    return new Lookups(
        serviceRepository.findByTenant_IdOrderByNameAsc(tenantId).stream()
            .collect(Collectors.toMap(SalonService::getId, Function.identity())),
        professionalRepository.findByTenant_IdOrderByFullNameAsc(tenantId).stream()
            .collect(Collectors.toMap(Professional::getId, Function.identity())));
  }

  public Map<Long, String> professionalNames(long tenantId) {
    Map<Long, String> names = new HashMap<>();
    professionalRepository
        .findByTenant_IdOrderByFullNameAsc(tenantId)
        .forEach(p -> names.put(p.getId(), p.getFullName()));
    return names;
  }

  private VersionView view(
      CommissionConfigVersion v, CommissionConfigSnapshot snapshot, Lookups lookups, Instant now) {
    SalonService s = v.getServiceId() == null ? null : lookups.services().get(v.getServiceId());
    Professional p =
        v.getProfessionalId() == null ? null : lookups.professionals().get(v.getProfessionalId());
    String previous =
        snapshot
            .versionAt(ScopeKey.of(v), v.getEffectiveFrom().minusMillis(1))
            .filter(prev -> !Objects.equals(prev.getId(), v.getId()))
            .map(CommissionConfigVersion::getConfigValue)
            .orElse(null);
    return new VersionView(
        v.getId(),
        v.getScope().name(),
        v.getServiceId(),
        s == null ? null : s.getName(),
        s == null ? null : s.getKind().name(),
        v.getProfessionalId(),
        p == null ? null : p.getFullName(),
        v.getConfigValue(),
        previous,
        v.getEffectiveFrom(),
        v.getApplyMode().name(),
        v.getStatus().name(),
        v.getStatus() == CommissionVersionStatus.ACTIVE && v.getEffectiveFrom().isAfter(now),
        v.getCreatedAt(),
        v.getCreatedByEmail());
  }
}
