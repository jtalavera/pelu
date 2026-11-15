package com.cursorpoc.backend.commission;

import com.cursorpoc.backend.domain.CommissionEntry;
import com.cursorpoc.backend.domain.CommissionSettlement;
import com.cursorpoc.backend.domain.enums.CommissionPeriodicity;
import com.cursorpoc.backend.domain.enums.CommissionSettlementStatus;
import com.cursorpoc.backend.domain.enums.ServiceKind;
import com.cursorpoc.backend.repository.CommissionEntryRepository;
import com.cursorpoc.backend.repository.CommissionGroupRepository;
import com.cursorpoc.backend.repository.CommissionSettlementRepository;
import com.cursorpoc.backend.web.dto.CommissionDtos.Overview;
import com.cursorpoc.backend.web.dto.CommissionDtos.OverviewRow;
import com.cursorpoc.backend.web.dto.CommissionDtos.PeriodInfo;
import com.cursorpoc.backend.web.dto.CommissionDtos.ProfessionalRuleSummary;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * HU-COM-15: what the home and the «Liquidar» screen show — one row per professional for a
 * settlement period (what she earned and where it stands) plus the things worth reviewing.
 */
@Service
public class CommissionOverviewService {

  private final CommissionConfigService configService;
  private final CommissionLedger ledger;
  private final CommissionQueryService queryService;
  private final CommissionGroupService groupService;
  private final AguinaldoService aguinaldoService;
  private final CommissionEntryRepository entryRepository;
  private final CommissionSettlementRepository settlementRepository;
  private final CommissionGroupRepository groupRepository;

  public CommissionOverviewService(
      CommissionConfigService configService,
      CommissionLedger ledger,
      CommissionQueryService queryService,
      CommissionGroupService groupService,
      AguinaldoService aguinaldoService,
      CommissionEntryRepository entryRepository,
      CommissionSettlementRepository settlementRepository,
      CommissionGroupRepository groupRepository) {
    this.configService = configService;
    this.ledger = ledger;
    this.queryService = queryService;
    this.groupService = groupService;
    this.aguinaldoService = aguinaldoService;
    this.entryRepository = entryRepository;
    this.settlementRepository = settlementRepository;
    this.groupRepository = groupRepository;
  }

  /** The settlement period {@code offset} periods from the current one (0, -1, -2…). */
  CommissionPeriods.Period periodAt(long tenantId, int offset, Instant now) {
    ZoneId zone = configService.zone();
    CommissionConfigSnapshot snapshot = ledger.snapshot(tenantId);
    CommissionPeriodicity periodicity = snapshot.periodicityAt(now);
    LocalDate today = LocalDate.ofInstant(now, zone);
    int back = Math.min(0, offset);
    if (periodicity == CommissionPeriodicity.MANUAL) {
      LocalDate first = today.withDayOfMonth(1).plusMonths(back);
      LocalDate last = back == 0 ? today : first.withDayOfMonth(first.lengthOfMonth());
      return new CommissionPeriods.Period(first, last);
    }
    CommissionPeriods.Period p = CommissionPeriods.periodContaining(periodicity, today);
    for (int i = 0; i > back; i--) {
      p = CommissionPeriods.periodContaining(periodicity, p.from().minusDays(1));
    }
    return p;
  }

  @Transactional(readOnly = true)
  public Overview overview(long tenantId, int offset) {
    Instant now = Instant.now();
    ZoneId zone = configService.zone();
    CommissionConfigSnapshot snapshot = ledger.snapshot(tenantId);
    CommissionPeriods.Period period = periodAt(tenantId, offset, now);
    PeriodInfo info = configService.currentPeriod(snapshot, now);
    PeriodInfo shown =
        new PeriodInfo(
            snapshot.periodicityAt(now).name(),
            period.from(),
            period.to(),
            info == null ? null : info.nextFrom());

    Map<Long, String> names = configService.professionalNames(tenantId);
    List<Long> activeIds = configService.activeProfessionalIds(tenantId);
    List<ProfessionalRuleSummary> summary =
        groupService.professionalsSummary(tenantId).professionals();
    Map<Long, Integer> ruleCounts = new HashMap<>();
    summary.forEach(s -> ruleCounts.put(s.professionalId(), s.ruleCount()));

    Map<Long, CommissionSettlement> inPeriod = new HashMap<>();
    for (CommissionSettlement s :
        settlementRepository.findByTenantIdOrderByPeriodFromDescIdDesc(tenantId)) {
      if (s.getStatus() != CommissionSettlementStatus.VOIDED
          && !s.getPeriodFrom().isAfter(period.to())
          && !s.getPeriodTo().isBefore(period.from())) {
        inPeriod.putIfAbsent(s.getProfessionalId(), s);
      }
    }
    List<Long> ids = new ArrayList<>(activeIds);
    inPeriod.keySet().stream().filter(id -> !ids.contains(id)).forEach(ids::add);

    Instant end = period.endInstant(zone);
    List<OverviewRow> rows = new ArrayList<>();
    BigDecimal total = BigDecimal.ZERO;
    BigDecimal retentionTotal = BigDecimal.ZERO;
    int unsettled = 0;
    int drafts = 0;
    int approved = 0;
    int paid = 0;
    for (Long id : ids) {
      CommissionSettlement s = inPeriod.get(id);
      String status;
      BigDecimal amount;
      BigDecimal retention;
      Long settlementId = null;
      int lineCount;
      java.time.LocalDate paidOn = null;
      if (s != null) {
        List<CommissionEntry> entries =
            entryRepository.findBySettlementIdOrderByAccrualAtAscIdAsc(s.getId());
        status = s.getStatus().name();
        amount = s.getTotalAmount();
        retention = sum(entries);
        settlementId = s.getId();
        lineCount = entries.size();
        if (s.getStatus() == CommissionSettlementStatus.PAID && s.getPaidAt() != null) {
          paidOn = LocalDate.ofInstant(s.getPaidAt(), zone);
        }
      } else {
        List<CommissionEntry> entries = entryRepository.findUnsettled(tenantId, id, end);
        amount =
            entries.stream()
                .map(CommissionEntry::getCommissionAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        retention = sum(entries);
        lineCount = entries.size();
        status = entries.isEmpty() ? "NONE" : "UNSETTLED";
      }
      switch (status) {
        case "UNSETTLED" -> unsettled++;
        case "DRAFT" -> drafts++;
        case "APPROVED" -> approved++;
        case "PAID" -> paid++;
        default -> {}
      }
      total = total.add(amount);
      retentionTotal = retentionTotal.add(retention);
      rows.add(
          new OverviewRow(
              id,
              names.get(id),
              status,
              amount,
              retention,
              settlementId,
              ruleCounts.getOrDefault(id, 0),
              lineCount,
              paidOn));
    }
    rows.sort(
        Comparator.comparing(
            r -> r.professionalName() == null ? "" : r.professionalName().toLowerCase()));

    int withoutRules = (int) summary.stream().filter(s -> s.ruleCount() == 0).count();
    boolean aguinaldo = snapshot.aguinaldoEnabledAt(now);
    return new Overview(
        shown,
        Math.min(0, offset),
        rows,
        total,
        retentionTotal,
        unsettled,
        drafts,
        approved,
        paid,
        queryService.linesWithoutBeneficiary(tenantId, null, null).size(),
        groupService.ungrouped(tenantId, ServiceKind.SERVICE).size(),
        withoutRules,
        groupRepository.findByTenantIdOrderByNameAsc(tenantId).size(),
        aguinaldo,
        aguinaldo ? aguinaldoService.summary(tenantId).totalBalance() : BigDecimal.ZERO);
  }

  private static BigDecimal sum(List<CommissionEntry> entries) {
    return entries.stream()
        .map(CommissionEntry::getRetentionAmount)
        .reduce(BigDecimal.ZERO, BigDecimal::add);
  }
}
