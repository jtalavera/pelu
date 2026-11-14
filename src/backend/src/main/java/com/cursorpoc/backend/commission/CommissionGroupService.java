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
import com.cursorpoc.backend.web.dto.CommissionDtos.GroupAssignment;
import com.cursorpoc.backend.web.dto.CommissionDtos.GroupRuleRow;
import com.cursorpoc.backend.web.dto.CommissionDtos.GroupSuggestion;
import com.cursorpoc.backend.web.dto.CommissionDtos.GroupView;
import com.cursorpoc.backend.web.dto.CommissionDtos.ProfessionalRulesView;
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
              long pros =
                  snapshot.timelines().keySet().stream()
                      .filter(
                          k ->
                              k.scope() == CommissionConfigScope.GROUP_RULE
                                  && Objects.equals(k.groupId(), g.getId())
                                  && k.professionalId() != null
                                  && snapshot
                                      .groupRuleAt(g.getId(), k.professionalId(), now)
                                      .isPresent())
                      .count();
              return new GroupView(
                  g.getId(),
                  g.getName(),
                  members.size(),
                  members.stream().map(SalonService::getName).limit(SAMPLE_NAMES).toList(),
                  (int) pros);
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
    return new GroupView(g.getId(), g.getName(), 0, List.of(), 0);
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
    if (assignments == null || assignments.isEmpty()) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "COMMISSION_GROUP_ASSIGNMENT_REQUIRED");
    }
    int changed = 0;
    for (GroupAssignment a : assignments) {
      SalonService s =
          serviceRepository
              .findByIdAndTenant_Id(a.serviceId(), tenantId)
              .orElseThrow(
                  () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "SERVICE_NOT_FOUND"));
      if (a.groupId() != null) {
        find(tenantId, a.groupId());
      }
      if (!Objects.equals(s.getCommissionGroupId(), a.groupId())) {
        s.setCommissionGroupId(a.groupId());
        changed++;
      }
    }
    return changed;
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

  // ── Rules of one professional ─────────────────────────────────────────────────────────────

  /** One row per group with the rule in force for the professional at {@code date}. */
  @Transactional(readOnly = true)
  public ProfessionalRulesView professionalRules(
      long tenantId, long professionalId, LocalDate date) {
    Professional p =
        professionalRepository
            .findByIdAndTenant_Id(professionalId, tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "PROFESSIONAL_NOT_FOUND"));
    var zone = configService.zone();
    LocalDate day = date != null ? date : LocalDate.now(zone);
    Instant at =
        day.equals(LocalDate.now(zone))
            ? Instant.now()
            : day.plusDays(1).atStartOfDay(zone).toInstant().minusMillis(1);
    CommissionConfigSnapshot snapshot = ledger.snapshot(tenantId);
    Map<Long, Long> counts = new HashMap<>();
    for (SalonService s : serviceRepository.findByTenant_IdAndActiveTrueOrderByNameAsc(tenantId)) {
      if (s.getCommissionGroupId() != null) {
        counts.merge(s.getCommissionGroupId(), 1L, Long::sum);
      }
    }
    CommissionRuleValue.FixedDestination defaultDestination = snapshot.fixedDestinationAt(at);
    List<GroupRuleRow> rows = new ArrayList<>();
    for (CommissionGroup g : groupRepository.findByTenantIdOrderByNameAsc(tenantId)) {
      Optional<CommissionConfigVersion> own = snapshot.groupRuleAt(g.getId(), professionalId, at);
      boolean scheduled =
          !snapshot.scheduledAfter(ScopeKey.group(g.getId(), professionalId), at).isEmpty();
      CommissionRuleValue value =
          own.map(v -> CommissionRuleValue.parse(v.getConfigValue())).orElse(null);
      CommissionRuleValue.FixedDestination explicit =
          value == null ? null : value.fixedDestination();
      rows.add(
          new GroupRuleRow(
              g.getId(),
              g.getName(),
              counts.getOrDefault(g.getId(), 0L).intValue(),
              own.isPresent(),
              value == null ? null : value.percent(),
              value == null ? null : value.retentionPercent(),
              value == null ? null : value.fixedAmount(),
              explicit == null ? null : explicit.name(),
              (explicit != null ? explicit : defaultDestination).name(),
              own.map(CommissionConfigVersion::getId).orElse(null),
              scheduled));
    }
    BigDecimal retention = snapshot.retentionProfileAt(professionalId, at);
    return new ProfessionalRulesView(
        professionalId,
        p.getDisplayName(),
        p.isActive(),
        snapshot.baseAt(at).name(),
        snapshot.aguinaldoEnabledAt(at),
        retention,
        defaultDestination.name(),
        snapshot.defaultPercentAt(CommissionConfigScope.DEFAULT_SERVICE, at),
        rows);
  }
}
