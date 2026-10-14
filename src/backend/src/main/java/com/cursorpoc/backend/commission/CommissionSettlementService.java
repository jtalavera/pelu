package com.cursorpoc.backend.commission;

import com.cursorpoc.backend.domain.CommissionEntry;
import com.cursorpoc.backend.domain.CommissionSettlement;
import com.cursorpoc.backend.domain.CommissionSettlementStatusChange;
import com.cursorpoc.backend.domain.enums.CommissionEntrySource;
import com.cursorpoc.backend.domain.enums.CommissionSettlementStatus;
import com.cursorpoc.backend.repository.CommissionEntryRepository;
import com.cursorpoc.backend.repository.CommissionSettlementRepository;
import com.cursorpoc.backend.repository.CommissionSettlementStatusChangeRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.web.dto.CommissionDtos.AdjustmentRequest;
import com.cursorpoc.backend.web.dto.CommissionDtos.GenerateSettlementsRequest;
import com.cursorpoc.backend.web.dto.CommissionDtos.PayRequest;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** HU-COM-06: Draft → Approved → Paid (and Voided) settlements per beneficiary and period. */
@Service
public class CommissionSettlementService {

  static final Set<String> PAYMENT_METHODS = Set.of("CASH", "TRANSFER", "OTHER");

  private final CommissionSettlementRepository settlementRepository;
  private final CommissionSettlementStatusChangeRepository changeRepository;
  private final CommissionEntryRepository entryRepository;
  private final ProfessionalRepository professionalRepository;
  private final CommissionLedger ledger;
  private final CommissionConfigService configService;

  public CommissionSettlementService(
      CommissionSettlementRepository settlementRepository,
      CommissionSettlementStatusChangeRepository changeRepository,
      CommissionEntryRepository entryRepository,
      ProfessionalRepository professionalRepository,
      CommissionLedger ledger,
      CommissionConfigService configService) {
    this.settlementRepository = settlementRepository;
    this.changeRepository = changeRepository;
    this.entryRepository = entryRepository;
    this.professionalRepository = professionalRepository;
    this.ledger = ledger;
    this.configService = configService;
  }

  /**
   * Creates one Draft per beneficiary with unsettled entries accrued up to the end of the period.
   * Beneficiaries without entries get no settlement; an overlap with a non-voided settlement of the
   * same beneficiary is rejected ({@code COMMISSION_PERIOD_OVERLAP}).
   */
  @Transactional
  public List<CommissionSettlement> generate(
      long tenantId, String actorEmail, GenerateSettlementsRequest request) {
    if (request == null
        || request.periodFrom() == null
        || request.periodTo() == null
        || request.periodTo().isBefore(request.periodFrom())) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "COMMISSION_PERIOD_INVALID");
    }
    ZoneId zone = configService.zone();
    Instant end = request.periodTo().plusDays(1).atStartOfDay(zone).toInstant();
    List<Long> targets =
        request.professionalIds() == null || request.professionalIds().isEmpty()
            ? entryRepository.findProfessionalsWithUnsettled(tenantId, end)
            : request.professionalIds();
    for (Long pid : targets) {
      professionalRepository
          .findByIdAndTenant_Id(pid, tenantId)
          .orElseThrow(
              () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "PROFESSIONAL_NOT_FOUND"));
      boolean overlap =
          settlementRepository
              .findByTenantIdAndProfessionalIdOrderByPeriodFromDescIdDesc(tenantId, pid)
              .stream()
              .filter(s -> s.getStatus() != CommissionSettlementStatus.VOIDED)
              .anyMatch(
                  s ->
                      !s.getPeriodFrom().isAfter(request.periodTo())
                          && !s.getPeriodTo().isBefore(request.periodFrom()));
      if (overlap) {
        throw new ResponseStatusException(HttpStatus.CONFLICT, "COMMISSION_PERIOD_OVERLAP");
      }
    }
    List<CommissionSettlement> created = new ArrayList<>();
    for (Long pid : targets) {
      List<CommissionEntry> entries = entryRepository.findUnsettled(tenantId, pid, end);
      if (entries.isEmpty()) {
        continue;
      }
      CommissionSettlement s = new CommissionSettlement();
      s.setTenantId(tenantId);
      s.setProfessionalId(pid);
      s.setPeriodFrom(request.periodFrom());
      s.setPeriodTo(request.periodTo());
      s.setStatus(CommissionSettlementStatus.DRAFT);
      s.setTotalAmount(BigDecimal.ZERO);
      s.setCreatedAt(Instant.now());
      s.setCreatedByEmail(actorEmail);
      s = settlementRepository.save(s);
      for (CommissionEntry e : entries) {
        e.setSettlementId(s.getId());
      }
      entryRepository.flush();
      ledger.recomputeTotal(s.getId());
      recordChange(s, null, CommissionSettlementStatus.DRAFT, actorEmail);
      created.add(s);
    }
    return created;
  }

  @Transactional
  public CommissionSettlement addAdjustment(
      long tenantId, long settlementId, String actorEmail, AdjustmentRequest request) {
    CommissionSettlement s = load(tenantId, settlementId);
    if (s.getStatus() != CommissionSettlementStatus.DRAFT) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "SETTLEMENT_NOT_EDITABLE");
    }
    if (request == null || request.reason() == null || request.reason().isBlank()) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "SETTLEMENT_ADJUSTMENT_REASON_REQUIRED");
    }
    if (request.amount() == null || request.amount().signum() == 0) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "SETTLEMENT_ADJUSTMENT_AMOUNT_INVALID");
    }
    ledger.adjustment(
        tenantId,
        s.getProfessionalId(),
        request.amount().setScale(0, java.math.RoundingMode.HALF_UP).setScale(2),
        CommissionLedger.REASON_MANUAL_ADJUSTMENT,
        request.reason().trim(),
        s.getId(),
        actorEmail);
    return s;
  }

  /** Approval freezes the settlement; a negative total is carried to the next one (C7). */
  @Transactional
  public CommissionSettlement approve(long tenantId, long settlementId, String actorEmail) {
    CommissionSettlement s = load(tenantId, settlementId);
    requireStatus(s, CommissionSettlementStatus.DRAFT);
    ledger.recomputeTotal(s.getId());
    if (s.getTotalAmount().signum() < 0) {
      BigDecimal carry = s.getTotalAmount().negate();
      ledger.adjustment(
          tenantId,
          s.getProfessionalId(),
          carry,
          CommissionLedger.REASON_CARRY_FORWARD_OUT,
          null,
          s.getId(),
          actorEmail);
      ledger.adjustment(
          tenantId,
          s.getProfessionalId(),
          carry.negate(),
          CommissionLedger.REASON_CARRY_FORWARD_IN,
          null,
          null,
          actorEmail);
    }
    s.setApprovedAt(Instant.now());
    s.setApprovedByEmail(actorEmail);
    transition(s, CommissionSettlementStatus.APPROVED, actorEmail);
    return s;
  }

  @Transactional
  public CommissionSettlement pay(
      long tenantId, long settlementId, String actorEmail, PayRequest request) {
    CommissionSettlement s = load(tenantId, settlementId);
    requireStatus(s, CommissionSettlementStatus.APPROVED);
    String method =
        request == null || request.paymentMethod() == null ? null : request.paymentMethod().trim();
    if (method == null || !PAYMENT_METHODS.contains(method)) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "SETTLEMENT_PAYMENT_METHOD_INVALID");
    }
    s.setPaymentMethod(method);
    s.setPaymentReference(
        request.paymentReference() == null || request.paymentReference().isBlank()
            ? null
            : request.paymentReference().trim());
    s.setPaidAt(
        request.paidOn() != null
            ? request.paidOn().atStartOfDay(configService.zone()).toInstant()
            : Instant.now());
    s.setPaidByEmail(actorEmail);
    transition(s, CommissionSettlementStatus.PAID, actorEmail);
    return s;
  }

  /** Draft or Approved only. Entries go back to unsettled; a carry forward is undone. */
  @Transactional
  public CommissionSettlement voidSettlement(
      long tenantId, long settlementId, String actorEmail, String reason) {
    CommissionSettlement s = load(tenantId, settlementId);
    if (s.getStatus() != CommissionSettlementStatus.DRAFT
        && s.getStatus() != CommissionSettlementStatus.APPROVED) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "SETTLEMENT_INVALID_STATE_TRANSITION");
    }
    if (reason == null || reason.isBlank()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SETTLEMENT_VOID_REASON_REQUIRED");
    }
    for (CommissionEntry e :
        entryRepository.findBySettlementIdOrderByAccrualAtAscIdAsc(s.getId())) {
      if (CommissionLedger.REASON_CARRY_FORWARD_OUT.equals(e.getReasonCode())
          || CommissionLedger.REASON_MANUAL_ADJUSTMENT.equals(e.getReasonCode())) {
        // Stays attached to the voided settlement, compensated there.
        ledger.reverse(
            e, CommissionLedger.REASON_CARRY_REVERSAL, Instant.now(), s.getId(), null, actorEmail);
        if (CommissionLedger.REASON_CARRY_FORWARD_OUT.equals(e.getReasonCode())) {
          undoCarryIn(tenantId, s.getProfessionalId(), e.getCommissionAmount(), actorEmail);
        }
        continue;
      }
      if (e.getSourceType() == CommissionEntrySource.REVERSAL
          && CommissionLedger.REASON_CARRY_REVERSAL.equals(e.getReasonCode())) {
        continue;
      }
      e.setSettlementId(null);
    }
    s.setVoidedAt(Instant.now());
    s.setVoidedByEmail(actorEmail);
    s.setVoidReason(reason.trim());
    transition(s, CommissionSettlementStatus.VOIDED, actorEmail);
    entryRepository.flush();
    ledger.recomputeTotal(s.getId());
    return s;
  }

  private void undoCarryIn(
      long tenantId, long professionalId, BigDecimal amount, String actorEmail) {
    ledger.adjustment(
        tenantId,
        professionalId,
        amount,
        CommissionLedger.REASON_CARRY_REVERSAL,
        null,
        null,
        actorEmail);
  }

  public CommissionSettlement load(long tenantId, long settlementId) {
    return settlementRepository
        .findByIdAndTenantId(settlementId, tenantId)
        .orElseThrow(
            () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "SETTLEMENT_NOT_FOUND"));
  }

  private static void requireStatus(CommissionSettlement s, CommissionSettlementStatus expected) {
    if (s.getStatus() != expected) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "SETTLEMENT_INVALID_STATE_TRANSITION");
    }
  }

  private void transition(
      CommissionSettlement s, CommissionSettlementStatus to, String actorEmail) {
    CommissionSettlementStatus from = s.getStatus();
    s.setStatus(to);
    recordChange(s, from, to, actorEmail);
  }

  private void recordChange(
      CommissionSettlement s,
      CommissionSettlementStatus from,
      CommissionSettlementStatus to,
      String actorEmail) {
    CommissionSettlementStatusChange c = new CommissionSettlementStatusChange();
    c.setSettlementId(s.getId());
    c.setFromStatus(from);
    c.setToStatus(to);
    c.setChangedAt(Instant.now());
    c.setChangedByEmail(actorEmail);
    changeRepository.save(c);
  }
}
