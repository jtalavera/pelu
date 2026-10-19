package com.cursorpoc.backend.commission;

import com.cursorpoc.backend.domain.CommissionConfigVersion;
import com.cursorpoc.backend.domain.enums.CommissionBaseType;
import com.cursorpoc.backend.domain.enums.CommissionConfigScope;
import com.cursorpoc.backend.domain.enums.CommissionPeriodicity;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

/**
 * In-memory view of a tenant's ACTIVE configuration versions. The value of a scope at an instant is
 * the version with the greatest {@code effectiveFrom <= instant} (ties: the latest created).
 */
public final class CommissionConfigSnapshot {

  public static final CommissionBaseType DEFAULT_BASE = CommissionBaseType.NET_OF_TAX;
  public static final CommissionPeriodicity DEFAULT_PERIODICITY = CommissionPeriodicity.MONTHLY;

  /** Identity of a timeline: scope plus, for RULE, item and (optional) professional. */
  public record ScopeKey(CommissionConfigScope scope, Long serviceId, Long professionalId) {

    public static ScopeKey of(CommissionConfigVersion v) {
      return new ScopeKey(v.getScope(), v.getServiceId(), v.getProfessionalId());
    }

    public static ScopeKey of(CommissionConfigScope scope) {
      return new ScopeKey(scope, null, null);
    }

    public static ScopeKey rule(long serviceId, Long professionalId) {
      return new ScopeKey(CommissionConfigScope.RULE, serviceId, professionalId);
    }
  }

  private static final Comparator<CommissionConfigVersion> ORDER =
      Comparator.comparing(CommissionConfigVersion::getEffectiveFrom)
          .thenComparing(v -> v.getId() == null ? Long.MAX_VALUE : v.getId());

  private final Map<ScopeKey, List<CommissionConfigVersion>> timelines = new HashMap<>();

  public CommissionConfigSnapshot(List<CommissionConfigVersion> activeVersions) {
    for (CommissionConfigVersion v : activeVersions) {
      timelines.computeIfAbsent(ScopeKey.of(v), k -> new ArrayList<>()).add(v);
    }
    timelines.values().forEach(list -> list.sort(ORDER));
  }

  public Map<ScopeKey, List<CommissionConfigVersion>> timelines() {
    return timelines;
  }

  /** Version in force for {@code key} at {@code at}, if any. */
  public Optional<CommissionConfigVersion> versionAt(ScopeKey key, Instant at) {
    List<CommissionConfigVersion> list = timelines.get(key);
    if (list == null) {
      return Optional.empty();
    }
    CommissionConfigVersion found = null;
    for (CommissionConfigVersion v : list) {
      if (!v.getEffectiveFrom().isAfter(at)) {
        found = v;
      }
    }
    return Optional.ofNullable(found);
  }

  /** Versions of {@code key} that take effect after {@code now} (scheduled changes). */
  public List<CommissionConfigVersion> scheduledAfter(ScopeKey key, Instant now) {
    return timelines.getOrDefault(key, List.of()).stream()
        .filter(v -> v.getEffectiveFrom().isAfter(now))
        .toList();
  }

  public CommissionBaseType baseAt(Instant at) {
    return versionAt(ScopeKey.of(CommissionConfigScope.BASE), at)
        .map(v -> CommissionBaseType.valueOf(v.getConfigValue()))
        .orElse(DEFAULT_BASE);
  }

  public CommissionPeriodicity periodicityAt(Instant at) {
    return versionAt(ScopeKey.of(CommissionConfigScope.PERIODICITY), at)
        .map(v -> CommissionPeriodicity.valueOf(v.getConfigValue()))
        .orElse(DEFAULT_PERIODICITY);
  }

  public BigDecimal defaultPercentAt(CommissionConfigScope defaultScope, Instant at) {
    return versionAt(ScopeKey.of(defaultScope), at)
        .map(v -> new BigDecimal(v.getConfigValue()))
        .orElse(BigDecimal.ZERO);
  }

  /** The rule version in force (non-null value) for the item / professional, if any. */
  public Optional<CommissionConfigVersion> ruleAt(long serviceId, Long professionalId, Instant at) {
    return versionAt(ScopeKey.rule(serviceId, professionalId), at)
        .filter(v -> v.getConfigValue() != null);
  }

  /** True when any scope of this item has a timeline (used by matrix / catalog warnings). */
  public boolean hasAnyRuleFor(long serviceId) {
    return timelines.keySet().stream()
        .anyMatch(
            k ->
                k.scope() == CommissionConfigScope.RULE
                    && Objects.equals(k.serviceId(), serviceId));
  }
}
