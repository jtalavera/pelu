package com.cursorpoc.backend.commission;

import com.cursorpoc.backend.commission.CommissionConfigSnapshot.ScopeKey;
import com.cursorpoc.backend.domain.CommissionConfigVersion;
import com.cursorpoc.backend.domain.CommissionGroup;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.enums.CommissionConfigScope;
import com.cursorpoc.backend.domain.enums.ServiceKind;
import com.cursorpoc.backend.repository.CommissionConfigVersionRepository;
import com.cursorpoc.backend.repository.CommissionGroupRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.web.dto.CommissionDtos.AssignGroupsResult;
import com.cursorpoc.backend.web.dto.CommissionDtos.GroupAssignment;
import com.cursorpoc.backend.web.dto.CommissionDtos.GroupServiceRow;
import com.cursorpoc.backend.web.dto.CommissionDtos.GroupSuggestion;
import com.cursorpoc.backend.web.dto.CommissionDtos.GroupView;
import com.cursorpoc.backend.web.dto.CommissionDtos.ProfessionalRuleSummary;
import com.cursorpoc.backend.web.dto.CommissionDtos.ProfessionalsRuleSummary;
import com.cursorpoc.backend.web.dto.CommissionDtos.RateException;
import com.cursorpoc.backend.web.dto.CommissionDtos.RateGroup;
import com.cursorpoc.backend.web.dto.CommissionDtos.RateItem;
import com.cursorpoc.backend.web.dto.CommissionDtos.RatesView;
import com.cursorpoc.backend.web.dto.CommissionDtos.UngroupedService;
import java.math.BigDecimal;
import java.text.Normalizer;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-COM-14: grupos de comisión (CRUD, asignación de servicios con sugerencias por nombre) y la
 * vista de reglas de una profesional (una fila por grupo).
 */
@Service
public class CommissionGroupService {

  private static final int MAX_NAME = 120;
  private static final int SAMPLE_NAMES = 6;

  /** Palabras (sin tildes, en minúscula) que sugieren un grupo además de su propio nombre. */
  private static final Map<String, List<String>> ALIASES =
      Map.of("tratamiento", List.of("bano de crema", "apli"));

  private final CommissionGroupRepository groupRepository;
  private final SalonServiceRepository serviceRepository;
  private final ProfessionalRepository professionalRepository;
  private final CommissionConfigVersionRepository versionRepository;
  private final CommissionLedger ledger;
  private final CommissionConfigService configService;

  public CommissionGroupService(
      CommissionGroupRepository groupRepository,
      SalonServiceRepository serviceRepository,
      ProfessionalRepository professionalRepository,
      CommissionConfigVersionRepository versionRepository,
      CommissionLedger ledger,
      CommissionConfigService configService) {
    this.groupRepository = groupRepository;
    this.serviceRepository = serviceRepository;
    this.professionalRepository = professionalRepository;
    this.versionRepository = versionRepository;
    this.ledger = ledger;
    this.configService = configService;
  }

  // ── Groups ────────────────────────────────────────────────────────────────────────────────

  @Transactional(readOnly = true)
  public List<GroupView> list(long tenantId) {
    CommissionConfigSnapshot snapshot = ledger.snapshot(tenantId);
    Instant now = Instant.now();
    Map<Long, List<SalonService>> byGroup =
        serviceRepository.findByTenant_IdAndActiveTrueOrderByNameAsc(tenantId).stream()
            .filter(s -> s.getCommissionGroupId() != null)
            .collect(Collectors.groupingBy(SalonService::getCommissionGroupId));
    return groupRepository.findByTenantIdOrderByNameAsc(tenantId).stream()
        .map(
            g -> {
              List<SalonService> members = byGroup.getOrDefault(g.getId(), List.of());
              return new GroupView(
                  g.getId(),
                  g.getName(),
                  members.size(),
                  members.stream().map(SalonService::getName).limit(SAMPLE_NAMES).toList(),
                  snapshot
                      .groupRuleAt(g.getId(), null, now)
                      .map(v -> CommissionRuleValue.parse(v.getConfigValue()).percent())
                      .orElse(null));
            })
        .toList();
  }

  @Transactional
  public GroupView create(long tenantId, String rawName) {
    String name = cleanName(rawName);
    if (groupRepository.existsByTenantIdAndNameIgnoreCase(tenantId, name)) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "COMMISSION_GROUP_NAME_TAKEN");
    }
    CommissionGroup g = new CommissionGroup();
    g.setTenantId(tenantId);
    g.setName(name);
    g.setCreatedAt(Instant.now());
    g = groupRepository.save(g);
    return new GroupView(g.getId(), g.getName(), 0, List.of(), null);
  }

  @Transactional
  public void rename(long tenantId, long id, String rawName) {
    CommissionGroup g = find(tenantId, id);
    String name = cleanName(rawName);
    if (!g.getName().equalsIgnoreCase(name)
        && groupRepository.existsByTenantIdAndNameIgnoreCase(tenantId, name)) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "COMMISSION_GROUP_NAME_TAKEN");
    }
    g.setName(name);
  }

  /** A group with rule history cannot be deleted (its versions are part of the audit trail). */
  @Transactional
  public void delete(long tenantId, long id) {
    CommissionGroup g = find(tenantId, id);
    boolean hasVersions =
        versionRepository.findByTenantIdOrderByCreatedAtDescIdDesc(tenantId).stream()
            .anyMatch(v -> Objects.equals(v.getGroupId(), id));
    if (hasVersions) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "COMMISSION_GROUP_HAS_RULES");
    }
    for (SalonService s : serviceRepository.findByTenant_IdOrderByNameAsc(tenantId)) {
      if (Objects.equals(s.getCommissionGroupId(), id)) {
        s.setCommissionGroupId(null);
      }
    }
    groupRepository.delete(g);
  }

  @Transactional
  public int assign(long tenantId, List<GroupAssignment> assignments) {
    return assignWithRows(tenantId, assignments).changed();
  }

  /**
   * Same as {@link #assign} and also returns each affected item as the list shows it afterwards
   * (group and name suggestion), so the screen does not have to read everything again.
   */
  @Transactional
  public AssignGroupsResult assignWithRows(long tenantId, List<GroupAssignment> assignments) {
    if (assignments == null || assignments.isEmpty()) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "COMMISSION_GROUP_ASSIGNMENT_REQUIRED");
    }
    // Two queries for the whole request (items and groups), not two per item.
    Map<Long, SalonService> items =
        serviceRepository
            .findByTenantIdAndIdIn(
                tenantId, assignments.stream().map(GroupAssignment::serviceId).distinct().toList())
            .stream()
            .collect(Collectors.toMap(SalonService::getId, s -> s, (x, y) -> x));
    List<CommissionGroup> groups = groupRepository.findByTenantIdOrderByNameAsc(tenantId);
    Map<Long, String> names = new HashMap<>();
    groups.forEach(g -> names.put(g.getId(), g.getName()));
    int changed = 0;
    for (GroupAssignment a : assignments) {
      SalonService s = items.get(a.serviceId());
      if (s == null) {
        throw new ResponseStatusException(HttpStatus.NOT_FOUND, "SERVICE_NOT_FOUND");
      }
      if (a.groupId() != null && !names.containsKey(a.groupId())) {
        throw new ResponseStatusException(HttpStatus.NOT_FOUND, "COMMISSION_GROUP_NOT_FOUND");
      }
      if (!Objects.equals(s.getCommissionGroupId(), a.groupId())) {
        s.setCommissionGroupId(a.groupId());
        changed++;
      }
    }
    List<GroupServiceRow> rows =
        assignments.stream()
            .map(GroupAssignment::serviceId)
            .distinct()
            .map(items::get)
            .map(s -> row(s, groups, names))
            .toList();
    return new AssignGroupsResult(changed, rows);
  }

  private GroupServiceRow row(
      SalonService s, List<CommissionGroup> groups, Map<Long, String> names) {
    return new GroupServiceRow(
        s.getId(),
        s.getName(),
        s.getCategory() == null ? null : s.getCategory().getName(),
        s.getPriceMinor(),
        s.getCommissionGroupId(),
        s.getCommissionGroupId() == null ? null : names.get(s.getCommissionGroupId()),
        s.getCommissionGroupId() == null ? suggest(s.getName(), groups) : null);
  }

  /** Puts every active item of {@code kind} that has no group into the group. */
  @Transactional
  public int assignUngrouped(long tenantId, long groupId, ServiceKind kind) {
    find(tenantId, groupId);
    int changed = 0;
    for (SalonService s : serviceRepository.findByTenant_IdAndActiveTrueOrderByNameAsc(tenantId)) {
      if (s.getKind() == kind && s.getCommissionGroupId() == null) {
        s.setCommissionGroupId(groupId);
        changed++;
      }
    }
    return changed;
  }

  /** Active items without group, each with the group its name suggests (if any). */
  @Transactional(readOnly = true)
  public List<UngroupedService> ungrouped(long tenantId, ServiceKind kind) {
    List<CommissionGroup> groups = groupRepository.findByTenantIdOrderByNameAsc(tenantId);
    return serviceRepository.findByTenant_IdAndActiveTrueOrderByNameAsc(tenantId).stream()
        .filter(s -> s.getKind() == kind && s.getCommissionGroupId() == null)
        .map(s -> new UngroupedService(s.getId(), s.getName(), suggest(s.getName(), groups)))
        .toList();
  }

  /** Every active item of {@code kind} with its group; ungrouped ones carry the name suggestion. */
  @Transactional(readOnly = true)
  public List<GroupServiceRow> services(long tenantId, ServiceKind kind) {
    List<CommissionGroup> groups = groupRepository.findByTenantIdOrderByNameAsc(tenantId);
    Map<Long, String> names = new HashMap<>();
    groups.forEach(g -> names.put(g.getId(), g.getName()));
    return serviceRepository.findByTenant_IdAndActiveTrueOrderByNameAsc(tenantId).stream()
        .filter(s -> s.getKind() == kind)
        .map(s -> row(s, groups, names))
        .toList();
  }

  /** Active professionals (by name) with their number of group rules in force and retention %. */
  @Transactional(readOnly = true)
  public ProfessionalsRuleSummary professionalsSummary(long tenantId) {
    CommissionConfigSnapshot snapshot = ledger.snapshot(tenantId);
    Instant now = Instant.now();
    // HU-COM-20: «rules» of a professional are the services where she is paid differently.
    Map<Long, Integer> counts = new HashMap<>();
    for (ScopeKey key : snapshot.timelines().keySet()) {
      if (key.scope() == CommissionConfigScope.RULE
          && key.professionalId() != null
          && snapshot.ruleAt(key.serviceId(), key.professionalId(), now).isPresent()) {
        counts.merge(key.professionalId(), 1, Integer::sum);
      }
    }
    List<ProfessionalRuleSummary> list =
        professionalRepository.findByTenant_IdOrderByFullNameAsc(tenantId).stream()
            .filter(Professional::isActive)
            .sorted(java.util.Comparator.comparing(p -> p.getDisplayName().toLowerCase()))
            .map(
                p ->
                    new ProfessionalRuleSummary(
                        p.getId(),
                        p.getDisplayName(),
                        counts.getOrDefault(p.getId(), 0),
                        snapshot.retentionProfileAt(p.getId(), now)))
            .toList();
    return new ProfessionalsRuleSummary(snapshot.aguinaldoEnabledAt(now), list);
  }

  static GroupSuggestion suggest(String serviceName, List<CommissionGroup> groups) {
    String name = normalize(serviceName);
    for (CommissionGroup g : groups) {
      String groupName = normalize(g.getName());
      if (!groupName.isEmpty() && name.contains(groupName)) {
        return new GroupSuggestion(g.getId(), g.getName(), groupName);
      }
      for (String alias : ALIASES.getOrDefault(groupName, List.of())) {
        if (name.contains(alias)) {
          return new GroupSuggestion(g.getId(), g.getName(), alias);
        }
      }
    }
    return null;
  }

  /** Lowercase without accents ("Pestañas" → "pestanas"). */
  static String normalize(String s) {
    return Normalizer.normalize(s == null ? "" : s, Normalizer.Form.NFD)
        .replaceAll("\\p{M}", "")
        .toLowerCase()
        .trim();
  }

  private CommissionGroup find(long tenantId, long id) {
    return groupRepository
        .findByIdAndTenantId(id, tenantId)
        .orElseThrow(
            () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "COMMISSION_GROUP_NOT_FOUND"));
  }

  private static String cleanName(String raw) {
    String name = raw == null ? "" : raw.trim().replaceAll("\\s+", " ");
    if (name.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "COMMISSION_GROUP_NAME_REQUIRED");
    }
    if (name.length() > MAX_NAME) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "COMMISSION_GROUP_NAME_TOO_LONG");
    }
    return name;
  }

  // ── Rates: group → service → professional (HU-COM-20) ─────────────────────────────────────

  /**
   * Every group with its % and its services, each with what it normally pays and who is paid
   * differently (the exceptions of professionals), as of {@code date} (today by default).
   */
  @Transactional(readOnly = true)
  public RatesView ratesView(long tenantId, LocalDate date) {
    var zone = configService.zone();
    LocalDate day = date != null ? date : LocalDate.now(zone);
    Instant at =
        day.equals(LocalDate.now(zone))
            ? Instant.now()
            : day.plusDays(1).atStartOfDay(zone).toInstant().minusMillis(1);
    CommissionConfigSnapshot snapshot = ledger.snapshot(tenantId);
    CommissionRuleValue.FixedDestination defaultDestination = snapshot.fixedDestinationAt(at);
    BigDecimal generalService =
        snapshot.defaultPercentAt(CommissionConfigScope.DEFAULT_SERVICE, at);
    BigDecimal generalProduct =
        snapshot.defaultPercentAt(CommissionConfigScope.DEFAULT_PRODUCT, at);
    List<Professional> professionals =
        professionalRepository.findByTenant_IdOrderByFullNameAsc(tenantId).stream()
            .filter(Professional::isActive)
            .toList();
    // Services with a change scheduled for later (any rule of the service, any professional).
    java.util.Set<Long> scheduledItems = new java.util.HashSet<>();
    java.util.Set<Long> scheduledGroups = new java.util.HashSet<>();
    for (var entry : snapshot.timelines().entrySet()) {
      ScopeKey key = entry.getKey();
      if (snapshot.scheduledAfter(key, at).isEmpty()) {
        continue;
      }
      if (key.scope() == CommissionConfigScope.RULE && key.serviceId() != null) {
        scheduledItems.add(key.serviceId());
      } else if (key.scope() == CommissionConfigScope.GROUP_RULE
          && key.groupId() != null
          && key.professionalId() == null) {
        scheduledGroups.add(key.groupId());
      }
    }
    List<CommissionGroup> groups = groupRepository.findByTenantIdOrderByNameAsc(tenantId);
    Map<Long, Optional<CommissionConfigVersion>> groupRules = new HashMap<>();
    groups.forEach(g -> groupRules.put(g.getId(), snapshot.groupRuleAt(g.getId(), null, at)));
    Map<Long, List<RateItem>> byGroup = new HashMap<>();
    List<RateItem> ungrouped = new ArrayList<>();
    for (SalonService s : serviceRepository.findByTenant_IdAndActiveTrueOrderByNameAsc(tenantId)) {
      Optional<CommissionConfigVersion> own = snapshot.ruleAt(s.getId(), null, at);
      Optional<CommissionConfigVersion> viaGroup =
          s.getCommissionGroupId() == null
              ? Optional.empty()
              : groupRules.getOrDefault(s.getCommissionGroupId(), Optional.empty());
      CommissionRuleValue ownValue =
          own.map(v -> CommissionRuleValue.parse(v.getConfigValue())).orElse(null);
      CommissionRuleValue normal =
          ownValue != null
              ? ownValue
              : viaGroup
                  .map(v -> CommissionRuleValue.parse(v.getConfigValue()))
                  .orElse(
                      CommissionRuleValue.ofPercent(
                          s.getKind() == ServiceKind.PRODUCT ? generalProduct : generalService));
      String source = ownValue != null ? "SERVICE" : viaGroup.isPresent() ? "GROUP" : "GENERAL";
      List<RateException> exceptions = new ArrayList<>();
      for (Professional p : professionals) {
        snapshot
            .ruleAt(s.getId(), p.getId(), at)
            .ifPresent(
                v -> {
                  CommissionRuleValue value = CommissionRuleValue.parse(v.getConfigValue());
                  exceptions.add(
                      new RateException(
                          p.getId(),
                          p.getDisplayName(),
                          value.percent(),
                          value.fixedAmount(),
                          value.fixedDestination() == null ? null : value.fixedDestination().name(),
                          !snapshot
                              .scheduledAfter(ScopeKey.rule(s.getId(), p.getId()), at)
                              .isEmpty()));
                });
      }
      RateItem item =
          new RateItem(
              s.getId(),
              s.getName(),
              s.getKind().name(),
              ownValue == null ? null : ownValue.percent(),
              ownValue == null ? null : ownValue.fixedAmount(),
              ownValue == null || ownValue.fixedDestination() == null
                  ? null
                  : ownValue.fixedDestination().name(),
              normal.percent(),
              normal.fixedAmount(),
              (normal.fixedDestination() != null ? normal.fixedDestination() : defaultDestination)
                  .name(),
              source,
              scheduledItems.contains(s.getId()),
              exceptions);
      if (s.getCommissionGroupId() == null) {
        ungrouped.add(item);
      } else {
        byGroup.computeIfAbsent(s.getCommissionGroupId(), k -> new ArrayList<>()).add(item);
      }
    }
    List<RateGroup> rateGroups =
        groups.stream()
            .map(
                g -> {
                  CommissionRuleValue value =
                      groupRules
                          .get(g.getId())
                          .map(v -> CommissionRuleValue.parse(v.getConfigValue()))
                          .orElse(null);
                  return new RateGroup(
                      g.getId(),
                      g.getName(),
                      value == null ? null : value.percent(),
                      value == null ? null : value.fixedAmount(),
                      value == null || value.fixedDestination() == null
                          ? null
                          : value.fixedDestination().name(),
                      scheduledGroups.contains(g.getId()),
                      byGroup.getOrDefault(g.getId(), List.of()));
                })
            .toList();
    return new RatesView(
        day,
        snapshot.baseAt(at).name(),
        generalService,
        generalProduct,
        defaultDestination.name(),
        rateGroups,
        ungrouped);
  }
}
