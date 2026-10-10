package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import java.time.LocalDateTime;
import java.util.List;
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
 *
 * <p><b>Transmission channel</b> ({@value #SYNC_SUBMISSION_FLAG}, resolved per tenant on every send
 * as global AND tier AND tenant): ON sends through the synchronous {@code SiRecepDE}; OFF sends
 * each invoice as a one-document lote through {@code SiRecepLoteDE} ({@link
 * SifenBatchReceptionClient}). An accepted lote leaves the invoice {@code PENDING_VERIFICATION}
 * with its {@code dProtConsLote} stored; the next {@link #transmit} (scheduled by the listener's
 * backoff) or a manual {@link #checkPendingStatus} polls {@code consulta-lote} ({@link
 * SifenBatchResultQueryClient}) for the document's final result instead of resending it. SIFEN
 * production answers {@code SiRecepDE} with {@code 1264} for taxpayers not enabled for the
 * synchronous service, which is why both channels exist.
 */
@Service
public class SifenInvoiceSubmissionService {

  private static final Logger log = LoggerFactory.getLogger(SifenInvoiceSubmissionService.class);

  /** ON → envío inmediato (SiRecepDE); OFF at any level → envío por lote (SiRecepLoteDE). */
  static final String SYNC_SUBMISSION_FLAG = "SIFEN_SYNC_SUBMISSION";

  private final SifenInvoiceSubmissionPersistenceService persistence;
  private final SifenDocumentSigningService signingService;
  private final SifenDocumentReceptionClient receptionClient;
  private final SifenDocumentQueryClient queryClient;
  private final SifenBatchReceptionClient batchReceptionClient;
  private final SifenBatchResultQueryClient batchResultQueryClient;
  private final FeatureFlagService featureFlagService;
  private final FemmeTimeProperties timeProperties;

  public SifenInvoiceSubmissionService(
      SifenInvoiceSubmissionPersistenceService persistence,
      SifenDocumentSigningService signingService,
      SifenDocumentReceptionClient receptionClient,
      SifenDocumentQueryClient queryClient,
      SifenBatchReceptionClient batchReceptionClient,
      SifenBatchResultQueryClient batchResultQueryClient,
      FeatureFlagService featureFlagService,
      FemmeTimeProperties timeProperties) {
    this.persistence = persistence;
    this.signingService = signingService;
    this.receptionClient = receptionClient;
    this.queryClient = queryClient;
    this.batchReceptionClient = batchReceptionClient;
    this.batchResultQueryClient = batchResultQueryClient;
    this.featureFlagService = featureFlagService;
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
      Optional<String> batchNumber = persistence.findBatchNumber(tenantId, invoiceId);
      if (batchNumber.isPresent()) {
        String cdc = persistence.requirePendingInvoiceControlNumber(tenantId, invoiceId);
        BatchPoll poll = pollBatch(tenantId, invoiceId, batchNumber.get(), cdc);
        if (poll.outcome() == BatchPollOutcome.RESOLVED) {
          return poll.result();
        }
        if (poll.outcome() == BatchPollOutcome.STILL_PENDING) {
          // SIFEN already holds the document in a lote: never resend it while that lote is
          // still being processed — the listener's backoff schedules the next poll.
          return pendingResult(null, null);
        }
      }
      Optional<SifenSubmissionResult> resolved = queryByControlNumber(tenantId, invoiceId);
      if (resolved.isPresent()) {
        return resolved.get();
      }
      if (batchNumber.isPresent()) {
        // The lote is gone (0360/0363, or it concluded without this document) and SIFEN doesn't
        // know the CDC either: forget the lote and send the document again below.
        persistence.setBatchNumber(tenantId, invoiceId, null);
      }
    }

    LocalDateTime signedAt = persistence.prepareForSubmission(tenantId, invoiceId);

    SifenSignedDocument signed = signingService.signInvoice(tenantId, invoiceId, signedAt);
    Document document = signed.document();
    String xml = SifenDocumentXmlService.serialize(document);

    // SIFEN HU-08: persisted regardless of what SIFEN answers below — the QR is a property of the
    // document actually transmitted, not of SIFEN's response to it (AC-11's "sent invoice" data).
    persistence.persistQrData(tenantId, invoiceId, signed.qrUrl(), signed.publicConsultationUrl());

    if (featureFlagService.isEnabled(SYNC_SUBMISSION_FLAG, tenantId)) {
      return sendSynchronously(tenantId, invoiceId, signed.controlNumber(), xml);
    }
    return sendInBatch(tenantId, invoiceId, signed.controlNumber(), xml);
  }

  /** Envío inmediato: {@code SiRecepDE} answers with the document's final result right away. */
  private SifenSubmissionResult sendSynchronously(
      long tenantId, long invoiceId, String controlNumber, String xml) {
    Optional<SifenSubmissionResult> response = receptionClient.send(tenantId, xml);
    SifenSubmissionResult result = response.orElseGet(() -> pendingResult(null, null));

    persistence.recordResult(tenantId, invoiceId, result, response.isPresent(), null);

    if (response.isPresent()) {
      log.info(
          "SIFEN submission recorded tenantId={} invoiceId={} controlNumber={} status={}",
          tenantId,
          invoiceId,
          controlNumber,
          result.status());
    } else {
      log.error(
          "SIFEN submission marked pending verification (no response) tenantId={} invoiceId={} "
              + "controlNumber={}",
          tenantId,
          invoiceId,
          controlNumber);
    }
    return result;
  }

  /**
   * Envío por lote: the document goes alone in a lote, so the one-invoice-per-queue-message model
   * (lease, attempts, backoff) stays exactly as it is. {@code SiRecepLoteDE} only acknowledges the
   * lote — an accepted one ({@code 0300}) leaves the invoice pending with its {@code
   * dProtConsLote}, polled later by {@link #pollBatch}; a lote SIFEN refuses to queue (e.g. {@code
   * 0301}) is recorded as a rejection, exactly like a synchronous rejection.
   */
  private SifenSubmissionResult sendInBatch(
      long tenantId, long invoiceId, String controlNumber, String xml) {
    Optional<SifenBatchSubmissionResult> ack = batchReceptionClient.send(tenantId, List.of(xml));
    if (ack.isEmpty()) {
      SifenSubmissionResult result = pendingResult(null, null);
      persistence.recordResult(tenantId, invoiceId, result, false, null);
      log.error(
          "SIFEN batch submission marked pending verification (no response) tenantId={} "
              + "invoiceId={} controlNumber={}",
          tenantId,
          invoiceId,
          controlNumber);
      return result;
    }

    SifenBatchSubmissionResult lote = ack.get();
    SifenSubmissionResult result;
    if (lote.accepted() && lote.batchNumber() != null && !lote.batchNumber().isBlank()) {
      persistence.setBatchNumber(tenantId, invoiceId, lote.batchNumber());
      result = pendingResult(lote.resultCode(), lote.message());
    } else {
      result =
          new SifenSubmissionResult(
              SifenSubmissionStatus.REJECTED, null, lote.resultCode(), lote.message(), now());
    }
    // A lote acknowledgment is a real SIFEN response: stamping sifenSubmittedAt keeps the 72h
    // signature-window guard from refusing to poll/resend a document SIFEN already received.
    persistence.recordResult(tenantId, invoiceId, result, true, null);
    log.info(
        "SIFEN batch submission recorded tenantId={} invoiceId={} controlNumber={} "
            + "batchNumber={} code={} status={}",
        tenantId,
        invoiceId,
        controlNumber,
        lote.batchNumber(),
        lote.resultCode(),
        result.status());
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
    Optional<String> batchNumber = persistence.findBatchNumber(tenantId, invoiceId);
    if (batchNumber.isPresent()) {
      BatchPoll poll = pollBatch(tenantId, invoiceId, batchNumber.get(), cdc);
      if (poll.outcome() == BatchPollOutcome.RESOLVED) {
        return Optional.of(poll.result());
      }
      if (poll.outcome() == BatchPollOutcome.STILL_PENDING) {
        return Optional.empty();
      }
    }
    return queryByControlNumber(tenantId, invoiceId);
  }

  /** HU-07: {@code SiConsDE} by CDC — works for documents sent through either channel. */
  private Optional<SifenSubmissionResult> queryByControlNumber(long tenantId, long invoiceId) {
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

  /**
   * Envío por lote: asks {@code consulta-lote} for the outcome of the lote the invoice was sent in.
   * {@code 0361} (still processing) or no answer → {@link BatchPollOutcome#STILL_PENDING}; {@code
   * 0362} with this CDC's row → the document's final result, persisted; anything else ({@code 0360}
   * unknown lote, {@code 0363} whole lote rejected, or a concluded lote without this CDC) → {@link
   * BatchPollOutcome#GONE}, and the caller falls back to querying by CDC.
   */
  private BatchPoll pollBatch(long tenantId, long invoiceId, String batchNumber, String cdc) {
    Optional<SifenBatchQueryResult> queried = batchResultQueryClient.query(tenantId, batchNumber);
    persistence.incrementBatchPollCount(tenantId, invoiceId);
    if (queried.isEmpty() || queried.get().stillProcessing()) {
      log.info(
          "SIFEN batch still pending tenantId={} invoiceId={} batchNumber={} answered={}",
          tenantId,
          invoiceId,
          batchNumber,
          queried.isPresent());
      return new BatchPoll(BatchPollOutcome.STILL_PENDING, null);
    }
    return applyBatchQueryResult(tenantId, invoiceId, batchNumber, cdc, queried.get());
  }

  /**
   * Records what a concluded {@code consulta-lote} answer says about this invoice's document.
   * Public so the e2e-only {@code SifenInvoiceTestSupportController} can feed it a fabricated
   * answer (e2e never reaches a real SIFEN) through exactly the same mapping the real poll uses.
   * Returns the persisted result, or empty when the answer carries no verdict for the invoice's
   * CDC.
   */
  public Optional<SifenSubmissionResult> recordBatchQueryResult(
      long tenantId, long invoiceId, SifenBatchQueryResult lote) {
    String cdc = persistence.requirePendingInvoiceControlNumber(tenantId, invoiceId);
    String batchNumber = persistence.findBatchNumber(tenantId, invoiceId).orElse(null);
    if (lote.stillProcessing()) {
      return Optional.empty();
    }
    return Optional.ofNullable(
        applyBatchQueryResult(tenantId, invoiceId, batchNumber, cdc, lote).result());
  }

  private BatchPoll applyBatchQueryResult(
      long tenantId, long invoiceId, String batchNumber, String cdc, SifenBatchQueryResult lote) {
    Optional<SifenBatchDocumentResult> document =
        lote.concluded()
            ? lote.documents().stream()
                .filter(d -> cdc.equals(d.cdc()) && d.status() != null)
                .findFirst()
            : Optional.empty();
    if (document.isEmpty()) {
      log.error(
          "SIFEN batch gave no result for the document tenantId={} invoiceId={} batchNumber={} "
              + "code={} message={}",
          tenantId,
          invoiceId,
          batchNumber,
          lote.batchResultCode(),
          lote.batchResultMessage());
      return new BatchPoll(BatchPollOutcome.GONE, null);
    }
    SifenBatchDocumentResult d = document.get();
    SifenSubmissionResult result =
        new SifenSubmissionResult(
            d.status(), d.protocolNumber(), d.resultCode(), d.message(), now());
    persistence.recordResult(tenantId, invoiceId, result, true, null);
    log.info(
        "SIFEN batch result recorded tenantId={} invoiceId={} batchNumber={} controlNumber={} "
            + "status={}",
        tenantId,
        invoiceId,
        batchNumber,
        cdc,
        result.status());
    return new BatchPoll(BatchPollOutcome.RESOLVED, result);
  }

  private SifenSubmissionResult pendingResult(String resultCode, String message) {
    return new SifenSubmissionResult(
        SifenSubmissionStatus.PENDING_VERIFICATION, null, resultCode, message, now());
  }

  private LocalDateTime now() {
    return LocalDateTime.now(timeProperties.zoneId());
  }

  private enum BatchPollOutcome {
    RESOLVED,
    STILL_PENDING,
    GONE
  }

  private record BatchPoll(BatchPollOutcome outcome, SifenSubmissionResult result) {}
}
