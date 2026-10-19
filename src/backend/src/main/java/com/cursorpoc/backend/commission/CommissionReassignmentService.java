package com.cursorpoc.backend.commission;

import com.cursorpoc.backend.domain.CommissionEntry;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.InvoiceLine;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.enums.CommissionEntrySource;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.repository.CommissionEntryRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.web.dto.CommissionDtos.AssignLineRequest;
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
 *
 * <p>It also assigns a professional to an issued line that was billed without one (HU-COM-13): the
 * line gets its beneficiary and accrues its commission as if it had been set at billing.
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
    Professional target = activeProfessional(tenantId, request.professionalId());
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

  /**
   * HU-COM-13: an issued, non-voided catalog line billed without a professional gets one. The
   * fiscal invoice is untouched; the commission is computed with the rules in force at the
   * invoice's issue and stays unsettled, so it goes into the professional's next settlement.
   */
  @Transactional
  public CommissionEntry assignLine(
      long tenantId, long lineId, String actorEmail, AssignLineRequest request) {
    InvoiceLine line = entityManager.find(InvoiceLine.class, lineId);
    if (line == null || line.getInvoice().getTenant().getId() != tenantId) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "INVOICE_LINE_NOT_FOUND");
    }
    Invoice invoice = line.getInvoice();
    SalonService item = line.getSalonService();
    if (invoice.getStatus() == InvoiceStatus.VOIDED
        || invoice.getIssuedAt() == null
        || item == null
        || line.getProfessional() != null) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "COMMISSION_LINE_NOT_ASSIGNABLE");
    }
    Professional target =
        activeProfessional(tenantId, request == null ? null : request.professionalId());
    Integer lastRevision =
        entityManager
            .createQuery(
                "SELECT MAX(e.revision) FROM CommissionEntry e WHERE e.invoiceLineId = :lineId"
                    + " AND e.sourceType = :source",
                Integer.class)
            .setParameter("lineId", line.getId())
            .setParameter("source", CommissionEntrySource.INVOICE_LINE)
            .getSingleResult();
    CommissionLedger.LineInput input =
        new CommissionLedger.LineInput(
            tenantId,
            target.getId(),
            invoice.getId(),
            line.getId(),
            CommissionAccrualService.formatNumber(invoice),
            item.getId(),
            item.getName(),
            item.getKind(),
            line.getLineTotal(),
            line.getTaxAmount());
    CommissionEntry entry =
        ledger.computeLineEntry(
            ledger.snapshot(tenantId),
            input,
            invoice.getIssuedAt(),
            lastRevision == null ? 1 : lastRevision + 1);
    String note = request.note() == null ? "" : request.note().trim();
    if (!note.isEmpty()) {
      entry.setNote(note.length() > 500 ? note.substring(0, 500) : note);
    }
    CommissionEntry saved = ledger.save(entry, null, actorEmail);
    line.setProfessional(target);
    return saved;
  }

  private Professional activeProfessional(long tenantId, Long professionalId) {
    if (professionalId == null) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "PROFESSIONAL_NOT_FOUND");
    }
    Professional target =
        professionalRepository
            .findByIdAndTenant_Id(professionalId, tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "PROFESSIONAL_NOT_FOUND"));
    if (!target.isActive()) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "COMMISSION_PROFESSIONAL_INACTIVE");
    }
    return target;
  }
}
