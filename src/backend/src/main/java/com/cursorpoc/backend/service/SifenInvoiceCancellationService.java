package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.repository.InvoiceRepository;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
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

  /**
   * Real finding, confirmed live: SIFEN's own test sandbox clock runs measurably behind real UTC
   * (see {@code SifenInvoiceSubmissionPersistenceService}'s own javadoc for the diagnosis and the
   * EP-05 homologación live tests' own {@code CLOCK_SAFETY_BUFFER}) — an event's declared signature
   * date/time (GDE004) needs this same margin, or SIFEN rejects it as being ahead of its own clock.
   * Applied only to the value used as the event's signature timestamp — the local AC-02 window
   * check below still compares against the true, unbuffered {@code now}.
   */
  private static final Duration SIFEN_CLOCK_SKEW_BUFFER = Duration.ofMinutes(2);

  /**
   * Issue #145: cancelling an invoice within {@link #SIFEN_CLOCK_SKEW_BUFFER} of its own approval
   * reproduced a real SIFEN rejection ("Plazo de solicitud de cancelación... extemporáneo", dCodRes
   * 4009) that the {@code earliestAfterApproval} clamp below could not itself avoid: for a
   * cancellation attempted that soon after approval, "after {@code sifenSubmittedAt}" and "behind
   * SIFEN's own lagging clock by {@code SIFEN_CLOCK_SKEW_BUFFER}" become mutually exclusive
   * constraints — there is no valid signature timestamp satisfying both yet. Rather than let the
   * clamp silently discard the skew buffer (and risk the same rejection), block the attempt up
   * front with a clear, translated error until enough real time has passed for both constraints to
   * be satisfiable together.
   */
  static final Duration MINIMUM_CANCELLATION_DELAY =
      SIFEN_CLOCK_SKEW_BUFFER.plus(Duration.ofMinutes(1));

  private final InvoiceRepository invoiceRepository;
  private final SifenCancellationEventXmlService eventXmlService;
  private final SifenDocumentSigningService signingService;
  private final SifenEventClient eventClient;
  private final FemmeTimeProperties timeProperties;
  private final SifenInvoiceNotificationService notificationService;

  /**
   * Real bug, confirmed live: {@code cancel()}'s calls to {@code prepareForCancellation}/{@code
   * recordCancellationResult} were plain {@code this.} self-invocations, which bypass Spring's
   * {@code @Transactional} proxy entirely (a same-class call never goes through the proxy) — every
   * mutation those two methods made to the {@code Invoice} entity was silently lost, since the
   * short-lived read session {@code requireInvoice} opens closes immediately after the read. This
   * was previously documented as known tech debt (the identical bug {@code
   * SifenInvoiceClientIdentificationService} already found and fixed for HU-11, deliberately not
   * backported here since nothing had exercised {@code cancel()} through a real Spring context) —
   * confirmed as a real, live, reproducible data-loss bug: a genuinely-approved invoice's
   * cancellation attempt got a real SIFEN response (approved or rejected) but persisted absolutely
   * nothing, not even the AC-05 audit trail. Same {@code @Autowired @Lazy} self-proxy fix as
   * HU-11's; see that class's javadoc for why field injection (not a constructor param) and
   * {@code @Lazy} are both required.
   */
  @Autowired @Lazy private SifenInvoiceCancellationService selfProxy;

  public SifenInvoiceCancellationService(
      InvoiceRepository invoiceRepository,
      SifenCancellationEventXmlService eventXmlService,
      SifenDocumentSigningService signingService,
      SifenEventClient eventClient,
      FemmeTimeProperties timeProperties,
      SifenInvoiceNotificationService notificationService) {
    this.invoiceRepository = invoiceRepository;
    this.eventXmlService = eventXmlService;
    this.signingService = signingService;
    this.eventClient = eventClient;
    this.timeProperties = timeProperties;
    this.notificationService = notificationService;
  }

  private SifenInvoiceCancellationService self() {
    return selfProxy != null ? selfProxy : this;
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
        self().prepareForCancellation(tenantId, invoiceId, userId, userEmail, reason);

    Document unsigned =
        eventXmlService.buildCancellationEvent(
            request.cdc(), reason, request.eventId(), request.signedAt());
    Document signed = signingService.signEvent(tenantId, unsigned);
    String xml = SifenDocumentXmlService.serialize(signed);

    Optional<SifenSubmissionResult> response = eventClient.send(tenantId, xml, "cancellation");
    if (response.isEmpty()) {
      log.error(
          "SIFEN cancellation got no response tenantId={} invoiceId={} controlNumber={}",
          tenantId,
          invoiceId,
          request.cdc());
      throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "SIFEN_CANCELLATION_NO_RESPONSE");
    }

    SifenSubmissionResult result = response.get();
    self().recordCancellationResult(tenantId, invoiceId, result);
    if (result.status() == SifenSubmissionStatus.APPROVED
        || result.status() == SifenSubmissionStatus.APPROVED_WITH_OBSERVATION) {
      // Issue #173 item 3: SIFEN approved the cancellation — email the client a notice with the
      // cancelled document's data + KuDE. Best-effort; never throws, so the cancellation still
      // succeeds even if the notice can't be sent.
      notificationService.emailCancellationNotice(tenantId, invoiceId);
    }
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
    // Real finding, confirmed live: unconditionally subtracting SIFEN_CLOCK_SKEW_BUFFER can push
    // the event's signature timestamp (GDE004) to *before* the invoice's own real SIFEN approval
    // instant when cancelling shortly after approval (dCodRes=4009 "Plazo de solicitud de
    // cancelación... extemporáneo", same rule from the opposite direction — see
    // SifenHomologationEventsLiveTest's postApprovalSignatureInstant() for the same finding in
    // EP-05's own test). Never earlier than one second after invoice.getSifenSubmittedAt() (the
    // closest available proxy for SIFEN's own approval instant, per this class's javadoc) guards
    // against that while still keeping the clock-skew margin for invoices cancelled well after
    // approval, where sifenSubmittedAt is safely in the past already.
    LocalDateTime signatureInstant = now.minus(SIFEN_CLOCK_SKEW_BUFFER);
    if (invoice.getSifenSubmittedAt() != null) {
      LocalDateTime earliestAfterApproval = invoice.getSifenSubmittedAt().plusSeconds(1);
      if (signatureInstant.isBefore(earliestAfterApproval)) {
        signatureInstant = earliestAfterApproval;
      }
    }
    return new CancellationRequest(cdc, eventId, signatureInstant);
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
      // Issue #145: "Cancelar factura en Sifen" now merges the standalone "Anular comprobante"
      // action — a successful SIFEN cancellation also voids the invoice record, deliberately
      // bypassing InvoiceService.voidInvoice's cash-session-closed guard: the fiscal cancellation
      // with SIFEN is irreversible, so the internal record must not be left inconsistent with it.
      invoice.setStatus(InvoiceStatus.VOIDED);
      invoice.setVoidReason(invoice.getSifenCancellationReason());
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
    if (now.isBefore(approvedAt.plus(MINIMUM_CANCELLATION_DELAY))) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "SIFEN_INVOICE_CANCELLATION_TOO_SOON");
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
