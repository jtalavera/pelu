package com.cursorpoc.backend.commission;

import com.cursorpoc.backend.domain.CommissionEntry;
import com.cursorpoc.backend.domain.InvoiceLine;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.enums.CommissionEntrySource;
import com.cursorpoc.backend.repository.CommissionEntryRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.web.dto.CommissionDtos.ReassignRequest;
import jakarta.persistence.EntityManager;
import java.time.Instant;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Changes the professional who earns a commission when the line was assigned to the wrong one. The
 * fiscal invoice is untouched; in the ledger the wrong entry is reversed and a new one is accrued
 * for the right professional, recalculated with the rules in force at the sale. The invoice line's
 * beneficiary is updated so voids / corrections keep following the right person.
 */
@Service
public class CommissionReassignmentService {

  public static final String REASON_REASSIGNMENT = "REASSIGNMENT";

  private final CommissionEntryRepository entryRepository;
  private final ProfessionalRepository professionalRepository;
  private final CommissionLedger ledger;
  private final EntityManager entityManager;

  public CommissionReassignmentService(
      CommissionEntryRepository entryRepository,
      ProfessionalRepository professionalRepository,
      CommissionLedger ledger,
      EntityManager entityManager) {
    this.entryRepository = entryRepository;
    this.professionalRepository = professionalRepository;
    this.ledger = ledger;
    this.entityManager = entityManager;
  }

  @Transactional
  public CommissionEntry reassign(
      long tenantId, long entryId, String actorEmail, ReassignRequest request) {
    CommissionEntry original =
        entryRepository
            .findById(entryId)
            .filter(e -> e.getTenantId() == tenantId)
            .orElseThrow(
                () ->
                    new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "COMMISSION_ENTRY_NOT_FOUND"));
    if (original.getSourceType() != CommissionEntrySource.INVOICE_LINE
        || entryRepository.existsByReversesEntryId(original.getId())) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "COMMISSION_ENTRY_NOT_REASSIGNABLE");
    }
    if (request == null || request.reason() == null || request.reason().isBlank()) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "COMMISSION_REASSIGN_REASON_REQUIRED");
    }
    if (request.professionalId() == null) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "PROFESSIONAL_NOT_FOUND");
    }
    Professional target =
        professionalRepository
            .findByIdAndTenant_Id(request.professionalId(), tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "PROFESSIONAL_NOT_FOUND"));
    if (!target.isActive()) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "COMMISSION_PROFESSIONAL_INACTIVE");
    }
    if (target.getId().equals(original.getProfessionalId())) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "COMMISSION_REASSIGN_SAME_PROFESSIONAL");
    }
    String reason = request.reason().trim();

    // Same placement rule as a void: inside an open (Draft / unsettled) settlement the pair cancels
    // out where it is; a closed (Approved / Paid) one is never touched — the correction goes to the
    // next settlement.
    CommissionEntry reversal;
    if (ledger.isClosed(original.getSettlementId())) {
      reversal =
          ledger.reverse(original, REASON_REASSIGNMENT, Instant.now(), null, null, actorEmail);
    } else {
      reversal =
          ledger.reverse(
              original,
              REASON_REASSIGNMENT,
              original.getAccrualAt(),
              original.getSettlementId(),
              null,
              actorEmail);
    }
    CommissionLedger.LineInput input =
        new CommissionLedger.LineInput(
            tenantId,
            target.getId(),
            original.getInvoiceId(),
            original.getInvoiceLineId(),
            original.getInvoiceNumber(),
            original.getServiceId(),
            original.getItemName(),
            original.getItemKind(),
            original.getLineTotal(),
            original.getTaxAmount());
    CommissionEntry replacement =
        ledger.computeLineEntry(
            ledger.snapshot(tenantId), input, original.getAccrualAt(), original.getRevision() + 1);
    replacement.setNote(reason);
    CommissionEntry saved = ledger.save(replacement, null, actorEmail);

    if (original.getInvoiceLineId() != null) {
      InvoiceLine line = entityManager.find(InvoiceLine.class, original.getInvoiceLineId());
      if (line != null) {
        line.setProfessional(target);
      }
    }
    // The reason travels with the reversal too (same transaction that creates it).
    reversal.setNote(reason);
    return saved;
  }
}
