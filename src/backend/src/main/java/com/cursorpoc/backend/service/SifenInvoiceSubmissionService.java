package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import java.time.LocalDateTime;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.w3c.dom.Document;

/**
 * SIFEN HU-06: sends a document firmado (HU-04) to SIFEN's synchronous reception service ({@link
 * SifenDocumentReceptionClient}) and registers the result on the invoice. SIFEN HU-07: also queries
 * SIFEN directly ({@link SifenDocumentQueryClient}) for the real status of an invoice this system
 * marked 'pendiente de verificación' — both the manual trigger (AC-04, a controller calls {@link
 * #checkPendingStatus}) and the automatic one (AC-05, {@link #transmit} checks first before blindly
 * resending).
 *
 * <p>RT-20 (Hardening_SIFEN.md): what used to be one {@code submit(tenantId, invoiceId)} method is
 * now two, so no request thread ever makes a network call to SIFEN:
 *
 * <ul>
 *   <li>{@link #prepareAndSign} — called synchronously from {@code InvoiceController#issue}. Signs
 *       the document (minting the CDC/QR — RT-28's precondition for the KuDE being deliverable
 *       immediately) and marks the invoice {@code QUEUED}. Zero SIFEN network calls.
 *   <li>{@link #transmit} — called from {@code SifenSubmissionQueueListener} on the Service Bus
 *       consumer thread (or {@code LocalAsyncSifenSubmissionQueue} in {@code e2e}). Re-signs from
 *       the pinned {@code sifenSignedAt} (deterministic — same mechanism retries always used) and
 *       actually sends.
 * </ul>
 *
 * <p>Deliberately not itself {@code @Transactional}: the network call to SIFEN can take up to 30s,
 * and must not hold a database transaction/connection open for that long. The DB reads/writes this
 * method needs before and after that call live in {@link SifenInvoiceSubmissionPersistenceService}
 * instead — see that class's javadoc for why this split is required, not just a style choice.
 */
@Service
public class SifenInvoiceSubmissionService {

  private static final Logger log = LoggerFactory.getLogger(SifenInvoiceSubmissionService.class);

  private final SifenInvoiceSubmissionPersistenceService persistence;
  private final SifenDocumentSigningService signingService;
  private final SifenDocumentReceptionClient receptionClient;
  private final SifenDocumentQueryClient queryClient;
  private final FemmeTimeProperties timeProperties;

  public SifenInvoiceSubmissionService(
      SifenInvoiceSubmissionPersistenceService persistence,
      SifenDocumentSigningService signingService,
      SifenDocumentReceptionClient receptionClient,
      SifenDocumentQueryClient queryClient,
      FemmeTimeProperties timeProperties) {
    this.persistence = persistence;
    this.signingService = signingService;
    this.receptionClient = receptionClient;
    this.queryClient = queryClient;
    this.timeProperties = timeProperties;
  }

  /**
   * RT-20: runs on the request thread inside {@code InvoiceController#issue}. Signs the document
   * (persisting the CDC via {@code SifenInvoiceHeaderService} and the QR data) and marks the
   * invoice {@code QUEUED} — no call to SIFEN happens here. The caller is responsible for enqueuing
   * a transmit message afterward ({@code SifenSubmissionQueue#enqueue}).
   */
  public void prepareAndSign(long tenantId, long invoiceId) {
    LocalDateTime signedAt = persistence.prepareForSubmission(tenantId, invoiceId);
    SifenSignedDocument signed = signingService.signInvoice(tenantId, invoiceId, signedAt);
    persistence.persistQrData(tenantId, invoiceId, signed.qrUrl(), signed.publicConsultationUrl());
    persistence.markQueued(tenantId, invoiceId);
    log.info(
        "SIFEN document prepared and queued tenantId={} invoiceId={} controlNumber={}",
        tenantId,
        invoiceId,
        signed.controlNumber());
  }

  /**
   * RT-20: runs on the Service Bus consumer thread — the only place this class still calls SIFEN
   * over the network. Re-signs from the invoice's pinned {@code sifenSignedAt} (re-validating the
   * 72h transmission window and the not-already-approved guard on every attempt, exactly like the
   * pre-RT-20 {@code submit} did on every retry) to reproduce the exact same document, then sends
   * it. A {@code null} SIFEN response is not an error — it means "still pending, ask again later"
   * (HU-06 AC-05), resolved by a later call to {@link #checkPendingStatus} via {@code
   * SifenSubmissionReconciler}, never by resending the document.
   */
  public SifenSubmissionResult transmit(long tenantId, long invoiceId) {
    // HU-07 AC-05, and RT-20's own dedup requirement ("antes de cada reintento... verificar el
    // estado actual de la factura para no reenviar un documento que ya fue aprobado"): a
    // pending-verification invoice gets queried first, instead of blindly resending the same
    // document. checkPendingStatus resolving is what actually stops a resend once SIFEN approved
    // it out of band; if it's still ambiguous, falling through re-sends the identical document
    // (same pinned sifenSignedAt/CDC) — safe against SIFEN's synchronous reception service since
    // nothing about the document changed.
    if (persistence.isPendingVerification(tenantId, invoiceId)) {
      Optional<SifenSubmissionResult> resolved = checkPendingStatus(tenantId, invoiceId);
      if (resolved.isPresent()) {
        return resolved.get();
      }
    }

    LocalDateTime signedAt = persistence.prepareForSubmission(tenantId, invoiceId);

    SifenSignedDocument signed = signingService.signInvoice(tenantId, invoiceId, signedAt);
    Document document = signed.document();
    String xml = SifenDocumentXmlService.serialize(document);

    // SIFEN HU-08: persisted regardless of what SIFEN answers below — the QR is a property of the
    // document actually transmitted, not of SIFEN's response to it (AC-11's "sent invoice" data).
    persistence.persistQrData(tenantId, invoiceId, signed.qrUrl(), signed.publicConsultationUrl());

    Optional<SifenSubmissionResult> response = receptionClient.send(tenantId, xml);
    SifenSubmissionResult result =
        response.orElseGet(
            () ->
                new SifenSubmissionResult(
                    SifenSubmissionStatus.PENDING_VERIFICATION,
                    null,
                    null,
                    null,
                    LocalDateTime.now(timeProperties.zoneId())));

    persistence.recordResult(tenantId, invoiceId, result, response.isPresent(), null);

    if (response.isPresent()) {
      log.info(
          "SIFEN submission recorded tenantId={} invoiceId={} controlNumber={} status={}",
          tenantId,
          invoiceId,
          signed.controlNumber(),
          result.status());
    } else {
      log.error(
          "SIFEN submission marked pending verification (no response) tenantId={} invoiceId={} "
              + "controlNumber={}",
          tenantId,
          invoiceId,
          signed.controlNumber());
    }
    return result;
  }

  /**
   * HU-07 AC-01/AC-02/AC-03/AC-04: queries SIFEN directly for the real status of an invoice this
   * system marked 'pendiente de verificación'. Returns {@link Optional#empty()} — and leaves the
   * invoice untouched — if SIFEN still gives no interpretable answer; otherwise the invoice's
   * status (and, for AC-03, its full document content when found) is persisted and the resolved
   * result returned. Throws {@code SIFEN_INVOICE_NOT_PENDING_VERIFICATION} (409) if called on an
   * invoice that isn't currently pending verification — this check only ever makes sense for one.
   */
  public Optional<SifenSubmissionResult> checkPendingStatus(long tenantId, long invoiceId) {
    String cdc = persistence.requirePendingInvoiceControlNumber(tenantId, invoiceId);

    Optional<SifenQueryResult> queried = queryClient.query(tenantId, cdc);
    if (queried.isEmpty()) {
      log.error(
          "SIFEN status check got no answer tenantId={} invoiceId={} controlNumber={}",
          tenantId,
          invoiceId,
          cdc);
      return Optional.empty();
    }

    SifenQueryResult result = queried.get();
    persistence.recordResult(
        tenantId, invoiceId, result.submissionResult(), true, result.documentContent());
    log.info(
        "SIFEN status check resolved tenantId={} invoiceId={} controlNumber={} status={}",
        tenantId,
        invoiceId,
        cdc,
        result.submissionResult().status());
    return Optional.of(result.submissionResult());
  }
}
