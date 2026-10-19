package com.cursorpoc.backend.commission;

import com.cursorpoc.backend.domain.CommissionEntry;
import com.cursorpoc.backend.domain.CommissionSettlement;
import com.cursorpoc.backend.domain.enums.CommissionBaseType;
import com.cursorpoc.backend.domain.enums.CommissionEntrySource;
import com.cursorpoc.backend.domain.enums.CommissionSettlementStatus;
import com.cursorpoc.backend.domain.enums.CommissionVersionStatus;
import com.cursorpoc.backend.domain.enums.ServiceKind;
import com.cursorpoc.backend.repository.CommissionConfigVersionRepository;
import com.cursorpoc.backend.repository.CommissionEntryRepository;
import com.cursorpoc.backend.repository.CommissionSettlementRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * Writes the append-only ledger (P2/P3): line entries with their snapshot, reversals and
 * adjustments, and keeps settlement totals in sync.
 */
@Component
public class CommissionLedger {

  public static final String REASON_VOID = "VOID";
  public static final String REASON_CORRECTION = "CORRECTION";
  public static final String REASON_RECALCULATION = "RECALCULATION";
  public static final String REASON_MANUAL_ADJUSTMENT = "MANUAL_ADJUSTMENT";
  public static final String REASON_CARRY_FORWARD_OUT = "CARRY_FORWARD_OUT";
  public static final String REASON_CARRY_FORWARD_IN = "CARRY_FORWARD_IN";
  public static final String REASON_CARRY_REVERSAL = "CARRY_REVERSAL";

  private final CommissionConfigVersionRepository versionRepository;
  private final CommissionEntryRepository entryRepository;
  private final CommissionSettlementRepository settlementRepository;

  public CommissionLedger(
      CommissionConfigVersionRepository versionRepository,
      CommissionEntryRepository entryRepository,
      CommissionSettlementRepository settlementRepository) {
    this.versionRepository = versionRepository;
    this.entryRepository = entryRepository;
    this.settlementRepository = settlementRepository;
  }

  /** The data of a commissionable line, either from an invoice line or a previous snapshot. */
  public record LineInput(
      long tenantId,
      long professionalId,
      Long invoiceId,
      Long invoiceLineId,
      String invoiceNumber,
      long serviceId,
      String itemName,
      ServiceKind itemKind,
      BigDecimal lineTotal,
      BigDecimal taxAmount) {

    public static LineInput of(CommissionEntry e) {
      return new LineInput(
          e.getTenantId(),
          e.getProfessionalId(),
          e.getInvoiceId(),
          e.getInvoiceLineId(),
          e.getInvoiceNumber(),
          e.getServiceId(),
          e.getItemName(),
          e.getItemKind(),
          e.getLineTotal(),
          e.getTaxAmount());
    }
  }

  public CommissionConfigSnapshot snapshot(long tenantId) {
    return new CommissionConfigSnapshot(
        versionRepository.findByTenantIdAndStatus(tenantId, CommissionVersionStatus.ACTIVE));
  }

  /** Builds (without saving) the entry a line would produce with {@code snapshot} at {@code at}. */
  public CommissionEntry computeLineEntry(
      CommissionConfigSnapshot snapshot, LineInput line, Instant at, int revision) {
    CommissionCalculator.Resolution resolution =
        CommissionCalculator.resolve(
            snapshot, line.serviceId(), line.itemKind(), line.professionalId(), at);
    CommissionBaseType baseType = snapshot.baseAt(at);
    CommissionCalculator.Amounts amounts =
        CommissionCalculator.amounts(
            line.lineTotal(), line.taxAmount(), baseType, resolution.percent());
    CommissionEntry e = new CommissionEntry();
    e.setTenantId(line.tenantId());
    e.setProfessionalId(line.professionalId());
    e.setSourceType(CommissionEntrySource.INVOICE_LINE);
    e.setRevision(revision);
    e.setInvoiceId(line.invoiceId());
    e.setInvoiceLineId(line.invoiceLineId());
    e.setInvoiceNumber(line.invoiceNumber());
    e.setServiceId(line.serviceId());
    e.setItemName(line.itemName());
    e.setItemKind(line.itemKind());
    e.setBaseType(baseType);
    e.setLineTotal(line.lineTotal());
    e.setTaxAmount(line.taxAmount());
    e.setBaseAmount(amounts.baseAmount());
    e.setPercentApplied(resolution.percent());
    e.setRuleVersionId(resolution.ruleVersionId());
    e.setRuleOrigin(resolution.origin());
    e.setCommissionAmount(amounts.commissionAmount());
    e.setCurrency(CommissionCalculator.CURRENCY);
    e.setAccrualAt(at);
    e.setCreatedAt(Instant.now());
    return e;
  }

  /** True when two line entries carry the same calculation (nothing to recalculate). */
  public static boolean sameCalculation(CommissionEntry a, CommissionEntry b) {
    return a.getBaseType() == b.getBaseType()
        && a.getRuleOrigin() == b.getRuleOrigin()
        && java.util.Objects.equals(a.getRuleVersionId(), b.getRuleVersionId())
        && a.getPercentApplied().compareTo(b.getPercentApplied()) == 0
        && a.getCommissionAmount().compareTo(b.getCommissionAmount()) == 0;
  }

  public CommissionEntry save(CommissionEntry entry, Long settlementId, String actorEmail) {
    entry.setSettlementId(settlementId);
    entry.setCreatedByEmail(actorEmail);
    if (entry.getCreatedAt() == null) {
      entry.setCreatedAt(Instant.now());
    }
    CommissionEntry saved = entryRepository.save(entry);
    if (settlementId != null) {
      recomputeTotal(settlementId);
    }
    return saved;
  }

  /** Compensating entry for {@code original}. */
  public CommissionEntry reverse(
      CommissionEntry original,
      String reasonCode,
      Instant accrualAt,
      Long settlementId,
      Long recalculationId,
      String actorEmail) {
    CommissionEntry r = new CommissionEntry();
    r.setTenantId(original.getTenantId());
    r.setProfessionalId(original.getProfessionalId());
    r.setSourceType(CommissionEntrySource.REVERSAL);
    r.setRevision(original.getRevision());
    r.setReasonCode(reasonCode);
    r.setInvoiceId(original.getInvoiceId());
    r.setInvoiceLineId(original.getInvoiceLineId());
    r.setInvoiceNumber(original.getInvoiceNumber());
    r.setServiceId(original.getServiceId());
    r.setItemName(original.getItemName());
    r.setItemKind(original.getItemKind());
    r.setBaseType(original.getBaseType());
    r.setLineTotal(original.getLineTotal());
    r.setTaxAmount(original.getTaxAmount());
    r.setBaseAmount(original.getBaseAmount());
    r.setPercentApplied(original.getPercentApplied());
    r.setRuleVersionId(original.getRuleVersionId());
    r.setRuleOrigin(original.getRuleOrigin());
    r.setCommissionAmount(original.getCommissionAmount().negate());
    r.setCurrency(original.getCurrency());
    r.setAccrualAt(accrualAt);
    r.setReversesEntryId(original.getId());
    r.setRecalculationId(recalculationId);
    r.setNote(original.getNote());
    return save(r, settlementId, actorEmail);
  }

  /** A manual or carry adjustment of a beneficiary. */
  public CommissionEntry adjustment(
      long tenantId,
      long professionalId,
      BigDecimal amount,
      String reasonCode,
      String note,
      Long settlementId,
      String actorEmail) {
    CommissionEntry a = new CommissionEntry();
    a.setTenantId(tenantId);
    a.setProfessionalId(professionalId);
    a.setSourceType(CommissionEntrySource.ADJUSTMENT);
    a.setRevision(1);
    a.setReasonCode(reasonCode);
    a.setNote(note);
    a.setCommissionAmount(amount);
    a.setCurrency(CommissionCalculator.CURRENCY);
    a.setAccrualAt(Instant.now());
    return save(a, settlementId, actorEmail);
  }

  public CommissionSettlementStatus statusOf(Long settlementId) {
    if (settlementId == null) {
      return null;
    }
    return settlementRepository
        .findById(settlementId)
        .map(CommissionSettlement::getStatus)
        .orElse(null);
  }

  /** Settlement still open to changes (Draft): reversals and recalculations land in it. */
  public boolean isDraft(Long settlementId) {
    return statusOf(settlementId) == CommissionSettlementStatus.DRAFT;
  }

  /** Approved or Paid: immutable, corrections go to the next settlement. */
  public boolean isClosed(Long settlementId) {
    CommissionSettlementStatus s = statusOf(settlementId);
    return s == CommissionSettlementStatus.APPROVED || s == CommissionSettlementStatus.PAID;
  }

  public void recomputeTotal(long settlementId) {
    CommissionSettlement settlement = settlementRepository.findById(settlementId).orElseThrow();
    List<CommissionEntry> entries =
        entryRepository.findBySettlementIdOrderByAccrualAtAscIdAsc(settlementId);
    BigDecimal total =
        entries.stream()
            .map(CommissionEntry::getCommissionAmount)
            .reduce(BigDecimal.ZERO, BigDecimal::add);
    settlement.setTotalAmount(total);
  }
}
