package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.FiscalStamp;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.SifenNumberVoidingEvent;
import com.cursorpoc.backend.domain.enums.SifenNumberVoidingStatus;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.repository.SifenNumberVoidingEventRepository;
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
      SifenNumberVoidingEventXmlService eventXmlService,
      SifenDocumentSigningService signingService,
      SifenEventClient eventClient,
      FemmeTimeProperties timeProperties) {
    this.repository = repository;
    this.invoiceRepository = invoiceRepository;
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

  /** Manual Técnico V150 sección 11.6.2: first 15 natural days of the month following the event. */
  static LocalDate computeDeadline(LocalDate eventDate) {
    return eventDate.plusMonths(1).withDayOfMonth(1).plusDays(14);
  }

  @Transactional(readOnly = true)
  public List<SifenNumberVoidingEventResponse> listForTenant(long tenantId) {
    return repository.findByTenantIdOrderByDeadlineDateAsc(tenantId).stream()
        .map(this::toResponse)
        .toList();
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
    event.setStatus(mapStatus(result.status()));
    return toResponse(event);
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
