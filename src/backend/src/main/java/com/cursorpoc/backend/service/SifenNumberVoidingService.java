package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.FiscalStamp;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.SifenNumberVoidingEvent;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.domain.enums.SifenNumberVoidingStatus;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.repository.FiscalStampRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.repository.SifenNumberVoidingEventRepository;
import com.cursorpoc.backend.web.dto.PagedSifenNumberVoidingResponse;
import com.cursorpoc.backend.web.dto.SifenNumberVoidingEventResponse;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import org.w3c.dom.Document;

/**
 * RT-25 (Hardening_SIFEN.md): "Inutilización de numeración" governance — Manual Técnico V150
 * sección 11.6.2 requires reporting an unused document number range within the first 15 natural
 * days of the month following the event, and makes it mandatory when a rejected DE leaves a number
 * that will never be reused (the CDC embeds the invoice number, so a rejected invoice's number
 * can't simply be retried under the same CDC — Manual Técnico V150 sección 11.1, Tabla J). Only
 * {@link SifenNumberVoidingEventXmlService} existed before this, exercised solely by homologación
 * tests — no endpoint, no production trigger.
 *
 * <p><b>Deliberately synchronous, unlike {@link SifenInvoiceSubmissionService}'s RT-20 split.</b>
 * RT-20 moved SIFEN transmission off the request thread because it sits in the customer-facing
 * "issue an invoice" hot path. Submitting a voiding event is an admin-initiated, low-frequency
 * action — the same category {@link SifenInvoiceCancellationService} (HU-10) already handles
 * synchronously, and this mirrors that class's structure directly: build the unsigned event ({@link
 * SifenNumberVoidingEventXmlService}), sign it ({@link SifenDocumentSigningService#signEvent}),
 * send it ({@link SifenEventClient}), persist the result. No new queue abstraction is introduced.
 *
 * <p><b>Automatic trigger.</b> {@code recordPendingForRejectedInvoice} is called by {@code
 * SifenSubmissionQueueListener} the moment a transmit attempt resolves {@code REJECTED} — it only
 * *records* the pending voiding (status {@link SifenNumberVoidingStatus#PENDING}, a placeholder
 * reason, and the computed 15-day deadline); it never auto-submits to SIFEN. An admin reviews and
 * confirms the reason before it's actually sent — same "informative, not a hard action" posture
 * RT-19 uses for the homologación status. Idempotent: {@link
 * SifenNumberVoidingEventRepository#findByInvoiceId} guards against creating a second record for
 * the same invoice.
 */
@Service
public class SifenNumberVoidingService {

  private static final Logger log = LoggerFactory.getLogger(SifenNumberVoidingService.class);

  static final String AUTO_TRIGGER_REASON_PLACEHOLDER =
      "Factura rechazada por SIFEN; la numeración no será reutilizada.";

  private final SifenNumberVoidingEventRepository repository;
  private final InvoiceRepository invoiceRepository;
  private final FiscalStampRepository fiscalStampRepository;
  private final SifenNumberVoidingEventXmlService eventXmlService;
  private final SifenDocumentSigningService signingService;
  private final SifenEventClient eventClient;
  private final FemmeTimeProperties timeProperties;

  /**
   * Same self-invocation-bypasses-{@code @Transactional} pitfall {@link
   * SifenInvoiceCancellationService} already found and documented — {@code submit()} calls its own
   * {@code @Transactional} steps through this proxy so they actually commit.
   */
  @Autowired @Lazy private SifenNumberVoidingService selfProxy;

  public SifenNumberVoidingService(
      SifenNumberVoidingEventRepository repository,
      InvoiceRepository invoiceRepository,
      FiscalStampRepository fiscalStampRepository,
      SifenNumberVoidingEventXmlService eventXmlService,
      SifenDocumentSigningService signingService,
      SifenEventClient eventClient,
      FemmeTimeProperties timeProperties) {
    this.repository = repository;
    this.invoiceRepository = invoiceRepository;
    this.fiscalStampRepository = fiscalStampRepository;
    this.eventXmlService = eventXmlService;
    this.signingService = signingService;
    this.eventClient = eventClient;
    this.timeProperties = timeProperties;
  }

  private SifenNumberVoidingService self() {
    return selfProxy != null ? selfProxy : this;
  }

  @Transactional
  public void recordPendingForRejectedInvoice(long tenantId, long invoiceId) {
    if (repository.findByInvoiceId(invoiceId).isPresent()) {
      return;
    }
    Optional<Invoice> maybeInvoice = invoiceRepository.findByIdAndTenant_Id(invoiceId, tenantId);
    if (maybeInvoice.isEmpty()) {
      return;
    }
    Invoice invoice = maybeInvoice.get();
    FiscalStamp stamp = invoice.getFiscalStamp();

    LocalDateTime now = LocalDateTime.now(timeProperties.zoneId());
    SifenNumberVoidingEvent event = new SifenNumberVoidingEvent();
    event.setTenantId(tenantId);
    event.setFiscalStamp(stamp);
    event.setInvoiceId(invoiceId);
    event.setDocumentType(SifenDocumentType.FACTURA);
    event.setRangeFrom(invoice.getInvoiceNumber());
    event.setRangeTo(invoice.getInvoiceNumber());
    event.setReason(AUTO_TRIGGER_REASON_PLACEHOLDER);
    event.setStatus(SifenNumberVoidingStatus.PENDING);
    event.setDeadlineDate(computeDeadline(now.toLocalDate()));
    event.setCreatedAt(now);
    repository.save(event);
    log.info(
        "SIFEN number voiding recorded as pending tenantId={} invoiceId={} deadline={}",
        tenantId,
        invoiceId,
        event.getDeadlineDate());
  }

  /**
   * Current inutilización state for one invoice's number, or empty if none was ever recorded (never
   * rejected, or the auto-trigger hasn't fired). Read-only; used by {@code
   * InvoiceService.toDetailDto} so the frontend can hide "Corregir y reenviar" once the number is
   * genuinely dead.
   */
  @Transactional(readOnly = true)
  public Optional<SifenNumberVoidingStatus> statusForInvoice(long invoiceId) {
    return repository.findByInvoiceId(invoiceId).map(SifenNumberVoidingEvent::getStatus);
  }

  /**
   * Issue #175: a rejected invoice may be corrected and resent under the same CDC (its number is
   * reused, not abandoned) only while the auto-recorded inutilización is still merely {@code
   * PENDING} — once SIFEN has actually approved the voiding, the number is genuinely dead. A
   * missing record (never rejected, or the auto-trigger hasn't fired yet) is fine.
   */
  @Transactional(readOnly = true)
  public void requireVoidingStillPending(long invoiceId) {
    repository
        .findByInvoiceId(invoiceId)
        .ifPresent(
            event -> {
              if (event.getStatus() == SifenNumberVoidingStatus.APPROVED
                  || event.getStatus() == SifenNumberVoidingStatus.APPROVED_WITH_OBSERVATION) {
                throw new ResponseStatusException(
                    HttpStatus.CONFLICT, "SIFEN_NUMBER_ALREADY_VOIDED");
              }
            });
  }

  /**
   * Issue #175: called by {@code InvoiceService.correctAndResendInvoice} — the rejected number is
   * being reused under the same CDC, so its pending inutilización must be called off ({@link
   * SifenNumberVoidingStatus#CANCELLED}). No-op if there is no record or it isn't {@code PENDING}
   * (a submitted/approved voiding is caught earlier by {@link #requireVoidingStillPending}).
   */
  @Transactional
  public void cancelPendingForInvoice(long invoiceId) {
    repository
        .findByInvoiceId(invoiceId)
        .ifPresent(
            event -> {
              if (event.getStatus() == SifenNumberVoidingStatus.PENDING) {
                event.setStatus(SifenNumberVoidingStatus.CANCELLED);
                log.info(
                    "SIFEN number voiding cancelled (corrected & resent) invoiceId={}", invoiceId);
              }
            });
  }

  /** Manual Técnico V150 sección 11.6.2: first 15 natural days of the month following the event. */
  static LocalDate computeDeadline(LocalDate eventDate) {
    return eventDate.plusMonths(1).withDayOfMonth(1).plusDays(14);
  }

  /**
   * Issue #194: the "Numeración inutilizada" tab paginates this list server-side, like the invoice
   * history table. The response also carries the tenant-wide pending summary so the "X pendientes"
   * line stays correct on any page.
   */
  @Transactional(readOnly = true)
  public PagedSifenNumberVoidingResponse listForTenant(long tenantId, int page, int size) {
    // Deadline first (soonest on top), then newest first within the same deadline so a just-created
    // row lands on page 1.
    Pageable pageable =
        PageRequest.of(
            Math.max(0, page),
            Math.max(1, Math.min(size, 200)),
            Sort.by(Sort.Order.asc("deadlineDate"), Sort.Order.desc("id")));
    Page<SifenNumberVoidingEvent> result = repository.findByTenantId(tenantId, pageable);
    List<SifenNumberVoidingEventResponse> content =
        result.getContent().stream().map(this::toResponse).toList();
    Optional<PendingVoidingSummary> summary = pendingSummary(tenantId);
    return new PagedSifenNumberVoidingResponse(
        content,
        result.getNumber(),
        result.getSize(),
        result.getTotalElements(),
        result.getTotalPages(),
        summary.map(PendingVoidingSummary::count).orElse(0),
        summary.map(PendingVoidingSummary::soonestDeadline).orElse(null));
  }

  /**
   * Count + soonest deadline of the tenant's still-{@code PENDING} inutilizaciones (for the
   * dashboard alert).
   */
  public record PendingVoidingSummary(int count, LocalDate soonestDeadline) {}

  @Transactional(readOnly = true)
  public Optional<PendingVoidingSummary> pendingSummary(long tenantId) {
    List<SifenNumberVoidingEvent> pending =
        repository.findByTenantIdAndStatus(tenantId, SifenNumberVoidingStatus.PENDING);
    if (pending.isEmpty()) {
      return Optional.empty();
    }
    LocalDate soonest =
        pending.stream()
            .map(SifenNumberVoidingEvent::getDeadlineDate)
            .min(LocalDate::compareTo)
            .orElseThrow();
    return Optional.of(new PendingVoidingSummary(pending.size(), soonest));
  }

  /**
   * RT-25 "manual" path: an ADMIN declares a range of <b>unused</b> document numbers voided
   * (numbers skipped by a system error, a batch never issued, …). Creates a {@code PENDING} event —
   * the admin then submits it to SIFEN with the same per-row "Submit to SIFEN" action the
   * auto-recorded ones use. Guards (all {@link ResponseStatusException}):
   *
   * <ul>
   *   <li>{@code NO_ACTIVE_FISCAL_STAMP} — no active timbrado to anchor the range on.
   *   <li>{@code INVALID_NUMBER_RANGE} — {@code from < 1} or {@code from > to}.
   *   <li>{@code EMISSION_OUT_OF_RANGE} — the range escapes the active stamp's own range.
   *   <li>{@code SIFEN_VOIDING_RANGE_HAS_ISSUED_INVOICES} — a number in the range was actually
   *       issued.
   *   <li>{@code SIFEN_VOIDING_RANGE_OVERLAPS} — overlaps another non-CANCELLED voiding for this
   *       stamp.
   * </ul>
   */
  @Transactional
  public SifenNumberVoidingEventResponse createManual(
      long tenantId, int rangeFrom, int rangeTo, String reason) {
    FiscalStamp stamp =
        fiscalStampRepository
            .findByTenant_IdAndActiveTrue(tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.CONFLICT, "NO_ACTIVE_FISCAL_STAMP"));

    if (rangeFrom < 1 || rangeFrom > rangeTo) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_NUMBER_RANGE");
    }
    if (rangeFrom < stamp.getRangeFrom() || rangeTo > stamp.getRangeTo()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "EMISSION_OUT_OF_RANGE");
    }
    if (invoiceRepository.existsByTenant_IdAndFiscalStamp_IdAndInvoiceNumberBetween(
        tenantId, stamp.getId(), rangeFrom, rangeTo)) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "SIFEN_VOIDING_RANGE_HAS_ISSUED_INVOICES");
    }
    boolean overlaps =
        repository.findByTenantIdAndFiscalStamp_Id(tenantId, stamp.getId()).stream()
            .filter(e -> e.getStatus() != SifenNumberVoidingStatus.CANCELLED)
            .anyMatch(e -> rangeFrom <= e.getRangeTo() && rangeTo >= e.getRangeFrom());
    if (overlaps) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "SIFEN_VOIDING_RANGE_OVERLAPS");
    }

    LocalDateTime now = LocalDateTime.now(timeProperties.zoneId());
    SifenNumberVoidingEvent event = new SifenNumberVoidingEvent();
    event.setTenantId(tenantId);
    event.setFiscalStamp(stamp);
    event.setInvoiceId(null);
    event.setDocumentType(SifenDocumentType.FACTURA);
    event.setRangeFrom(rangeFrom);
    event.setRangeTo(rangeTo);
    event.setReason(reason.trim());
    event.setStatus(SifenNumberVoidingStatus.PENDING);
    event.setDeadlineDate(computeDeadline(now.toLocalDate()));
    event.setCreatedAt(now);
    repository.save(event);
    log.info(
        "SIFEN number voiding created manually tenantId={} range={}-{} deadline={}",
        tenantId,
        rangeFrom,
        rangeTo,
        event.getDeadlineDate());
    return toResponse(event);
  }

  /**
   * Issue: invoice-scoped entry point for {@code POST /api/invoices/{id}/sifen/nullify-number} —
   * the "Anular comprobante" action on a SIFEN-rejected invoice. Ensures the (auto-recorded)
   * pending inutilización exists, then submits it to SIFEN exactly like {@link #submit}. On a SIFEN
   * approval {@link #recordSubmissionResult} also voids the invoice ({@link
   * #voidInvoiceForApprovedNumberVoiding}). Never emits a cancellation event — a rejected DE was
   * never approved.
   */
  public SifenNumberVoidingEventResponse submitForInvoice(
      long tenantId, long invoiceId, String reason) {
    Invoice invoice =
        invoiceRepository
            .findByIdAndTenant_Id(invoiceId, tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "INVOICE_NOT_FOUND"));
    if (invoice.getSifenSubmissionStatus() != SifenSubmissionStatus.REJECTED) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "INVOICE_NOT_REJECTED");
    }
    self().recordPendingForRejectedInvoice(tenantId, invoiceId);
    SifenNumberVoidingEvent event =
        repository
            .findByInvoiceId(invoiceId)
            .orElseThrow(
                () ->
                    new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "SIFEN_NUMBER_VOIDING_NOT_FOUND"));
    return submit(tenantId, event.getId(), reason);
  }

  public SifenNumberVoidingEventResponse submit(long tenantId, long id, String reason) {
    SubmitPreparation prep = self().prepareForSubmission(tenantId, id);

    Document unsigned =
        eventXmlService.buildNumberVoidingEvent(
            prep.stampNumber(),
            prep.establishment(),
            prep.expeditionPoint(),
            prep.documentType(),
            prep.rangeFrom(),
            prep.rangeTo(),
            reason,
            prep.eventId(),
            prep.signedAt());
    Document signed = signingService.signEvent(tenantId, unsigned);
    String xml = SifenDocumentXmlService.serialize(signed);

    Optional<SifenSubmissionResult> response = eventClient.send(tenantId, xml, "number-voiding");
    if (response.isEmpty()) {
      log.error("SIFEN number voiding got no response tenantId={} id={}", tenantId, id);
      throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "SIFEN_NUMBER_VOIDING_NO_RESPONSE");
    }

    SifenNumberVoidingEventResponse result =
        self().recordSubmissionResult(tenantId, id, reason, response.get());
    log.info(
        "SIFEN number voiding resolved tenantId={} id={} status={}", tenantId, id, result.status());
    return result;
  }

  @Transactional
  SubmitPreparation prepareForSubmission(long tenantId, long id) {
    SifenNumberVoidingEvent event = requireEvent(tenantId, id);
    requireSubmittable(event);
    FiscalStamp stamp = event.getFiscalStamp();
    // Same epoch-seconds rationale as SifenInvoiceCancellationService.prepareForCancellation:
    // rEve's own Id attribute (tdIdEve) allows only 1-10 digits, which millis would overflow.
    long eventId = Instant.now().getEpochSecond();
    LocalDateTime signedAt = LocalDateTime.now(timeProperties.zoneId());
    return new SubmitPreparation(
        stamp.getStampNumber(),
        stamp.getEstablishment(),
        stamp.getExpeditionPoint(),
        event.getDocumentType(),
        event.getRangeFrom(),
        event.getRangeTo(),
        eventId,
        signedAt);
  }

  @Transactional
  SifenNumberVoidingEventResponse recordSubmissionResult(
      long tenantId, long id, String reason, SifenSubmissionResult result) {
    SifenNumberVoidingEvent event = requireEvent(tenantId, id);
    event.setReason(reason.trim());
    event.setSubmittedAt(LocalDateTime.now(timeProperties.zoneId()));
    event.setResultCode(result.resultCode());
    event.setMessage(result.message());
    event.setProtocolNumber(result.protocolNumber());
    SifenNumberVoidingStatus mapped = mapStatus(result.status());
    event.setStatus(mapped);
    if ((mapped == SifenNumberVoidingStatus.APPROVED
            || mapped == SifenNumberVoidingStatus.APPROVED_WITH_OBSERVATION)
        && event.getInvoiceId() != null) {
      voidInvoiceForApprovedNumberVoiding(tenantId, event.getInvoiceId(), result.protocolNumber());
    }
    return toResponse(event);
  }

  /**
   * Once SIFEN approves the inutilización, the rejected DE's number is genuinely dead — the
   * comprobante is voided internally too (reusing {@link com.cursorpoc.backend.domain.enums
   * .InvoiceStatus#VOIDED}, with a system reason), so it stops showing "Corregir y reenviar" and
   * drops out of the "issued" set. No SIFEN cancellation event is involved: a rejected DE was never
   * approved, there is nothing to cancel.
   */
  private void voidInvoiceForApprovedNumberVoiding(
      long tenantId, long invoiceId, String protocolNumber) {
    invoiceRepository
        .findByIdAndTenant_Id(invoiceId, tenantId)
        .filter(inv -> inv.getStatus() == InvoiceStatus.ISSUED)
        .ifPresent(
            inv -> {
              inv.setStatus(InvoiceStatus.VOIDED);
              inv.setVoidReason(
                  protocolNumber == null || protocolNumber.isBlank()
                      ? "Numeración inutilizada ante SIFEN"
                      : "Numeración inutilizada ante SIFEN (protocolo " + protocolNumber + ")");
              log.info(
                  "Invoice voided after SIFEN-approved number inutilización tenantId={} invoiceId={}",
                  tenantId,
                  invoiceId);
            });
  }

  private static SifenNumberVoidingStatus mapStatus(SifenSubmissionStatus status) {
    return switch (status) {
      case APPROVED -> SifenNumberVoidingStatus.APPROVED;
      case APPROVED_WITH_OBSERVATION -> SifenNumberVoidingStatus.APPROVED_WITH_OBSERVATION;
      default -> SifenNumberVoidingStatus.REJECTED;
    };
  }

  private static void requireSubmittable(SifenNumberVoidingEvent event) {
    if (event.getStatus() == SifenNumberVoidingStatus.APPROVED
        || event.getStatus() == SifenNumberVoidingStatus.APPROVED_WITH_OBSERVATION) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "SIFEN_NUMBER_VOIDING_ALREADY_APPROVED");
    }
  }

  private SifenNumberVoidingEvent requireEvent(long tenantId, long id) {
    return repository
        .findByIdAndTenantId(id, tenantId)
        .orElseThrow(
            () ->
                new ResponseStatusException(
                    HttpStatus.NOT_FOUND, "SIFEN_NUMBER_VOIDING_NOT_FOUND"));
  }

  private SifenNumberVoidingEventResponse toResponse(SifenNumberVoidingEvent event) {
    return new SifenNumberVoidingEventResponse(
        event.getId(),
        event.getDocumentType().name(),
        event.getRangeFrom(),
        event.getRangeTo(),
        event.getReason(),
        event.getStatus().name(),
        event.getDeadlineDate(),
        event.getCreatedAt().atZone(timeProperties.zoneId()).toInstant(),
        event.getSubmittedAt() == null
            ? null
            : event.getSubmittedAt().atZone(timeProperties.zoneId()).toInstant(),
        event.getResultCode(),
        event.getMessage(),
        event.getProtocolNumber(),
        event.getInvoiceId());
  }

  private record SubmitPreparation(
      String stampNumber,
      int establishment,
      int expeditionPoint,
      SifenDocumentType documentType,
      int rangeFrom,
      int rangeTo,
      long eventId,
      LocalDateTime signedAt) {}
}
