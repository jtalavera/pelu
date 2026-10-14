package com.cursorpoc.backend.commission;

import com.cursorpoc.backend.commission.CommissionConfigSnapshot.ScopeKey;
import com.cursorpoc.backend.domain.CommissionEntry;
import com.cursorpoc.backend.domain.CommissionRecalculation;
import com.cursorpoc.backend.domain.enums.CommissionConfigScope;
import com.cursorpoc.backend.domain.enums.ServiceKind;
import com.cursorpoc.backend.repository.CommissionEntryRepository;
import com.cursorpoc.backend.repository.CommissionRecalculationRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import org.springframework.stereotype.Service;

/**
 * §4.4 "Desde el inicio del periodo vigente" (PERIOD_START): re-issues the live entries of the
 * period affected by a change through reversal + new revision. Entries of Approved / Paid
 * settlements, manual adjustments and voided invoices (already reversed) are never touched.
 */
@Service
public class CommissionRecalculationService {

  private final CommissionEntryRepository entryRepository;
  private final CommissionRecalculationRepository recalculationRepository;
  private final CommissionLedger ledger;

  public CommissionRecalculationService(
      CommissionEntryRepository entryRepository,
      CommissionRecalculationRepository recalculationRepository,
      CommissionLedger ledger) {
    this.entryRepository = entryRepository;
    this.recalculationRepository = recalculationRepository;
    this.ledger = ledger;
  }

  public record Stats(
      int entriesRecalculated,
      int entriesExcluded,
      BigDecimal deltaAmount,
      Map<Long, BigDecimal> deltaByProfessional,
      Long recalculationId) {}

  static boolean affects(ScopeKey key, CommissionEntry e) {
    return switch (key.scope()) {
      case BASE -> true;
      case DEFAULT_SERVICE -> e.getItemKind() != ServiceKind.PRODUCT;
      case DEFAULT_PRODUCT -> e.getItemKind() == ServiceKind.PRODUCT;
      case RULE ->
          Objects.equals(key.serviceId(), e.getServiceId())
              && (key.professionalId() == null
                  || Objects.equals(key.professionalId(), e.getProfessionalId()));
      case PERIODICITY -> false;
    };
  }

  /** Earliest accrual of a live entry not in an Approved / Paid settlement ("último corte"). */
  public Instant earliestOpenAccrual(long tenantId, Instant fallback) {
    return entryRepository.findLiveLineEntriesSince(tenantId, Instant.EPOCH).stream()
        .filter(e -> !ledger.isClosed(e.getSettlementId()))
        .map(CommissionEntry::getAccrualAt)
        .min(Instant::compareTo)
        .orElse(fallback);
  }

  /** Must run in the transaction that inserted the new versions. */
  public Stats recalculate(
      long tenantId, Collection<ScopeKey> keys, Instant from, String actorEmail) {
    CommissionConfigSnapshot snapshot = ledger.snapshot(tenantId);
    ScopeKey first = keys.iterator().next();
    CommissionRecalculation recalculation = new CommissionRecalculation();
    recalculation.setTenantId(tenantId);
    recalculation.setScope(keys.size() == 1 ? first.scope() : CommissionConfigScope.RULE);
    recalculation.setServiceId(keys.size() == 1 ? first.serviceId() : null);
    recalculation.setProfessionalId(keys.size() == 1 ? first.professionalId() : null);
    recalculation.setPeriodFrom(from);
    recalculation.setEntriesRecalculated(0);
    recalculation.setEntriesExcluded(0);
    recalculation.setDeltaAmount(BigDecimal.ZERO);
    recalculation.setCreatedAt(Instant.now());
    recalculation.setCreatedByEmail(actorEmail);
    recalculation = recalculationRepository.save(recalculation);

    int recalculated = 0;
    int excluded = 0;
    BigDecimal delta = BigDecimal.ZERO;
    Map<Long, BigDecimal> byProfessional = new LinkedHashMap<>();
    for (CommissionEntry e : entryRepository.findLiveLineEntriesSince(tenantId, from)) {
      if (keys.stream().noneMatch(k -> affects(k, e))) {
        continue;
      }
      if (ledger.isClosed(e.getSettlementId())) {
        excluded++;
        continue;
      }
      CommissionEntry candidate =
          ledger.computeLineEntry(
              snapshot, CommissionLedger.LineInput.of(e), e.getAccrualAt(), e.getRevision() + 1);
      if (CommissionLedger.sameCalculation(e, candidate)) {
        continue;
      }
      ledger.reverse(
          e,
          CommissionLedger.REASON_RECALCULATION,
          e.getAccrualAt(),
          e.getSettlementId(),
          recalculation.getId(),
          actorEmail);
      candidate.setRecalculationId(recalculation.getId());
      ledger.save(candidate, e.getSettlementId(), actorEmail);
      recalculated++;
      BigDecimal diff = candidate.getCommissionAmount().subtract(e.getCommissionAmount());
      delta = delta.add(diff);
      byProfessional.merge(e.getProfessionalId(), diff, BigDecimal::add);
    }
    recalculation.setEntriesRecalculated(recalculated);
    recalculation.setEntriesExcluded(excluded);
    recalculation.setDeltaAmount(delta);
    return new Stats(recalculated, excluded, delta, byProfessional, recalculation.getId());
  }
}
