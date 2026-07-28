package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.repository.InvoiceRepository;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import org.w3c.dom.Document;

/**
 * SIFEN HU-10: cancels an already-approved invoice by registering a cancellation event ({@code
 * rGeVeCan}) with SIFEN — the first event-registration interaction in this integration (HU-06/07/08
 * /09 only ever did document reception/query). Orchestrates {@link
 * SifenCancellationEventXmlService} (build) + {@link SifenDocumentSigningService#signEvent} (sign,
 * reusing HU-04's XML-DSig machinery) + {@link SifenEventClient} (send), mirroring how {@link
 * SifenInvoiceSubmissionService} orchestrates the equivalent pieces for the DE itself.
 *
 * <p><b>AC-01/AC-02 eligibility is checked, and the request's audit fields (date/time/user/reason —
 * AC-05) are persisted, in one short transaction before any network activity</b> — same rationale
 * as {@code SifenInvoiceSubmissionService.prepareForSubmission}: a legitimate attempt should leave
 * a trace even if SIFEN's response never arrives.
 *
 * <p><b>AC-02's 48-hour window is measured from {@link Invoice#getSifenSubmittedAt()}</b> — the
 * instant this system recorded SIFEN's own approval response (HU-06's {@code recordResult}), the
 * closest available proxy for "fecha y hora de aprobación en el SIFEN" (Manual Técnico V150
 * GDE004a) this domain model has; no separate "approved at" column exists or is needed, since
 * {@code sifenSubmittedAt} is only ever set once, at the moment a terminal SIFEN response is
 * received.
 *
 * <p><b>Real live SIFEN verification note</b> (see PROGRESS.md for the full write-up): no document
 * this system has ever submitted reached genuine "Aprobado" status in SIFEN (three schema gaps
 * deferred to homologación — same limitation HU-06/07/08 already documented), so AC-03's happy path
 * (SIFEN approves the cancellation) could not be exercised live end-to-end. What was verified live
 * is {@link SifenEventClient} actually reaching the real event service and parsing a real
 * rejection-shaped response for AC-04's error-handling path.
 */
@Service
public class SifenInvoiceCancellationService {

  private static final Logger log = LoggerFactory.getLogger(SifenInvoiceCancellationService.class);

  /**
   * AC-02: Manual Técnico V150 sección 11.1.2 / Tabla J fila 1: "El emisor electrónico puede
   * solicitar la CANCELACIÓN de cualquier tipo de DTE y tiene hasta 48 hs. posteriores a la
   * aprobación de uso del DE para generar el evento" (Factura Electrónica specifically — other
   * document types get 168h, out of scope for this domain, which only ever issues facturas).
   */
  static final Duration CANCELLATION_WINDOW = Duration.ofHours(48);

  private final InvoiceRepository invoiceRepository;
  private final SifenCancellationEventXmlService eventXmlService;
  private final SifenDocumentSigningService signingService;
  private final SifenEventClient eventClient;
  private final FemmeTimeProperties timeProperties;

  public SifenInvoiceCancellationService(
      InvoiceRepository invoiceRepository,
      SifenCancellationEventXmlService eventXmlService,
      SifenDocumentSigningService signingService,
      SifenEventClient eventClient,
      FemmeTimeProperties timeProperties) {
    this.invoiceRepository = invoiceRepository;
    this.eventXmlService = eventXmlService;
    this.signingService = signingService;
    this.eventClient = eventClient;
    this.timeProperties = timeProperties;
  }

  /**
   * AC-01/AC-02: validates eligibility and records the attempt, builds+signs+sends the cancellation
   * event, then persists SIFEN's result — AC-03 (approved: invoice becomes {@code CANCELLED}) or
   * AC-04 (rejected: previous status untouched, rejection reason recorded). Throws {@code
   * SIFEN_CANCELLATION_NO_RESPONSE} (502) if SIFEN never answers — the invoice's status stays
   * whatever it was, but the request's audit fields (AC-05) remain persisted either way.
   */
  public SifenSubmissionResult cancel(
      long tenantId, long invoiceId, long userId, String userEmail, String reason) {
    CancellationRequest request =
        prepareForCancellation(tenantId, invoiceId, userId, userEmail, reason);

    Document unsigned =
        eventXmlService.buildCancellationEvent(
            request.cdc(), reason, request.eventId(), request.signedAt());
    Document signed = signingService.signEvent(tenantId, unsigned);
    String xml = SifenDocumentXmlService.serialize(signed);

    Optional<SifenSubmissionResult> response = eventClient.send(tenantId, xml);
    if (response.isEmpty()) {
      log.error(
          "SIFEN cancellation got no response tenantId={} invoiceId={} controlNumber={}",
          tenantId,
          invoiceId,
          request.cdc());
      throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "SIFEN_CANCELLATION_NO_RESPONSE");
    }

    SifenSubmissionResult result = response.get();
    recordCancellationResult(tenantId, invoiceId, result);
    log.info(
        "SIFEN cancellation resolved tenantId={} invoiceId={} controlNumber={} status={}",
        tenantId,
        invoiceId,
        request.cdc(),
        result.status());
    return result;
  }

  @Transactional
  CancellationRequest prepareForCancellation(
      long tenantId, long invoiceId, long userId, String userEmail, String reason) {
    Invoice invoice = requireInvoice(tenantId, invoiceId);
    LocalDateTime now = LocalDateTime.now(timeProperties.zoneId());
    requireCancellable(invoice, now);
    String cdc = requireControlNumber(invoice);

    invoice.setSifenCancellationRequestedAt(now);
    invoice.setSifenCancellationRequestedByUserId(userId);
    invoice.setSifenCancellationRequestedByEmail(userEmail);
    invoice.setSifenCancellationReason(reason == null ? null : reason.trim());

    // rEve's own Id attribute (tdIdEve, 1-10 digits) — epoch seconds, not millis (see
    // SifenCancellationEventXmlService's javadoc for why millis would overflow it).
    long eventId = Instant.now().getEpochSecond();
    return new CancellationRequest(cdc, eventId, now);
  }

  @Transactional
  void recordCancellationResult(long tenantId, long invoiceId, SifenSubmissionResult result) {
    Invoice invoice = requireInvoice(tenantId, invoiceId);
    invoice.setSifenCancellationResultCode(result.resultCode());
    invoice.setSifenCancellationMessage(result.message());
    invoice.setSifenCancellationProtocolNumber(result.protocolNumber());
    // AC-03: only a genuinely SIFEN-approved event moves the invoice to CANCELLED. AC-04: any other
    // outcome (rejected, or an unrecognized status this client didn't map) leaves the invoice's
    // status exactly as it was — no fallthrough to CANCELLED on ambiguity.
    if (result.status() == SifenSubmissionStatus.APPROVED
        || result.status() == SifenSubmissionStatus.APPROVED_WITH_OBSERVATION) {
      invoice.setSifenSubmissionStatus(SifenSubmissionStatus.CANCELLED);
    }
  }

  /**
   * AC-01/AC-02: only an invoice currently Aprobado/Aprobado con observación, within the 48h window
   * since {@code sifenSubmittedAt}, can be cancelled.
   */
  private static void requireCancellable(Invoice invoice, LocalDateTime now) {
    SifenSubmissionStatus status = invoice.getSifenSubmissionStatus();
    if (status != SifenSubmissionStatus.APPROVED
        && status != SifenSubmissionStatus.APPROVED_WITH_OBSERVATION) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "SIFEN_INVOICE_NOT_APPROVED");
    }

    LocalDateTime approvedAt = invoice.getSifenSubmittedAt();
    if (approvedAt == null) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "SIFEN_INVOICE_NOT_APPROVED");
    }
    LocalDateTime deadline = approvedAt.plus(CANCELLATION_WINDOW);
    if (now.isAfter(deadline)) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "SIFEN_INVOICE_CANCELLATION_WINDOW_EXPIRED");
    }
  }

  private static String requireControlNumber(Invoice invoice) {
    String cdc = invoice.getSifenControlNumber();
    if (cdc == null || cdc.isBlank()) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "SIFEN_INVOICE_MISSING_CONTROL_NUMBER");
    }
    return cdc;
  }

  private Invoice requireInvoice(long tenantId, long invoiceId) {
    return invoiceRepository
        .findByIdAndTenant_Id(invoiceId, tenantId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "INVOICE_NOT_FOUND"));
  }

  private record CancellationRequest(String cdc, long eventId, LocalDateTime signedAt) {}
}
