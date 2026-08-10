package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.repository.InvoiceRepository;
import java.time.Duration;
import java.time.LocalDateTime;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * SIFEN HU-06/HU-07: the short, separately-transactional DB reads/writes {@link
 * SifenInvoiceSubmissionService#submit} and {@link
 * SifenInvoiceSubmissionService#checkPendingStatus} need around the (non-transactional, potentially
 * slow) network call to SIFEN.
 *
 * <p>Split into its own bean — not just package-private methods on {@code
 * SifenInvoiceSubmissionService} — because Spring's {@code @Transactional} proxy only intercepts
 * calls that arrive from <b>outside</b> the bean; a same-class ("self-invoked") call bypasses the
 * proxy entirely and silently runs with no transaction at all, so any field mutated here would
 * never actually flush to the database if these methods stayed on the calling class. This was a
 * real, latent bug: every SIFEN e2e/homologation test exercised {@code submit}/{@code
 * checkPendingStatus} either through a fully-mocked repository (no real persistence context to
 * lose) or a JUnit "live" test with its own `@Transactional` test method wrapping everything in one
 * transaction — neither setup could have caught it. SIFEN HU-22 (Fase 5) is the first caller that
 * runs {@code submit()} through a real, no-test-shortcuts Spring context (a real invoice, issued
 * through {@code InvoiceController}, with no wrapping transaction), which is what surfaced it: the
 * invoice's {@code sifenSubmissionStatus}/{@code sifenQrUrl}/{@code sifenSignedAt} never persisted
 * even though the HTTP call to SIFEN's real (deliberately unreachable in {@code e2e}) endpoint
 * behaved exactly as documented.
 */
@Service
class SifenInvoiceSubmissionPersistenceService {

  /**
   * AC-07: Manual Técnico V150 ("La transmisión del DE firmado digitalmente contempla un plazo de
   * hasta 72 horas posteriores a la firma digital") — no es una regla propia, es la ventana real
   * que SIFEN exige.
   */
  static final Duration SIGNATURE_TRANSMISSION_WINDOW = Duration.ofHours(72);

  /**
   * Real finding, confirmed live against the actual SIFEN test sandbox through this exact
   * production code path (not just a test fixture): SIFEN's own server clock runs measurably behind
   * real UTC (verified against an external HTTP Date header at diagnosis time), so a
   * correctly-timestamped {@code dFecFirma} routinely gets rejected as {@code dCodRes=1004} "La
   * fecha y hora de la firma digital es adelantada". Every EP-05 homologación live test already
   * worked around this with its own local buffer (see e.g. {@code
   * SifenHomologationInvoiceSubmissionLiveTest}'s {@code CLOCK_SAFETY_BUFFER}) — this was
   * previously undocumented as a production-code gap because no test before this exercised {@code
   * prepareForSubmission} against the real sandbox through the real Spring-wired service (every
   * prior "live" test built its own document in isolation). Applied only to the value persisted as
   * {@code sifenSignedAt}/sent as {@code dFecFirma} — the local AC-07 window check below still
   * compares against the true, unbuffered {@code now}.
   */
  private static final Duration SIFEN_CLOCK_SKEW_BUFFER = Duration.ofMinutes(2);

  private final InvoiceRepository invoiceRepository;
  private final FemmeTimeProperties timeProperties;

  SifenInvoiceSubmissionPersistenceService(
      InvoiceRepository invoiceRepository, FemmeTimeProperties timeProperties) {
    this.invoiceRepository = invoiceRepository;
    this.timeProperties = timeProperties;
  }

  /**
   * AC-06/AC-07 guards, plus first-time persistence of {@code sifenSignedAt} — all inside one short
   * transaction, before any signing or network activity.
   */
  @Transactional
  LocalDateTime prepareForSubmission(long tenantId, long invoiceId) {
    Invoice invoice = requireInvoice(tenantId, invoiceId);
    requireNotAlreadyApproved(invoice);

    LocalDateTime now = LocalDateTime.now(timeProperties.zoneId());
    LocalDateTime signedAt = invoice.getSifenSignedAt();
    if (signedAt == null) {
      signedAt = now.minus(SIFEN_CLOCK_SKEW_BUFFER);
      invoice.setSifenSignedAt(signedAt);
    }

    requireWithinTransmissionWindow(invoice, signedAt, now);
    return signedAt;
  }

  @Transactional
  void persistQrData(long tenantId, long invoiceId, String qrUrl, String publicConsultationUrl) {
    Invoice invoice = requireInvoice(tenantId, invoiceId);
    invoice.setSifenQrUrl(qrUrl);
    invoice.setSifenPublicConsultationUrl(publicConsultationUrl);
  }

  /**
   * @param documentContent HU-07 AC-03: the full document content SIFEN returns from a query
   *     resolution (null for a HU-06 reception-service result, which never includes it).
   */
  @Transactional
  void recordResult(
      long tenantId,
      long invoiceId,
      SifenSubmissionResult result,
      boolean responseReceived,
      String documentContent) {
    Invoice invoice = requireInvoice(tenantId, invoiceId);
    invoice.setSifenSubmissionStatus(result.status());
    invoice.setSifenSubmissionProtocolNumber(result.protocolNumber());
    invoice.setSifenSubmissionResultCode(result.resultCode());
    invoice.setSifenSubmissionMessage(result.message());
    // AC-05: sifenSubmittedAt stays null while pending verification — no response was ever
    // actually received, so AC-07's "never sent before" condition must still hold on retry.
    if (responseReceived) {
      invoice.setSifenSubmittedAt(result.processedAt());
    }
    if (documentContent != null) {
      invoice.setSifenQueryDocumentContent(documentContent);
    }
  }

  @Transactional(readOnly = true)
  boolean isPendingVerification(long tenantId, long invoiceId) {
    return requireInvoice(tenantId, invoiceId).getSifenSubmissionStatus()
        == SifenSubmissionStatus.PENDING_VERIFICATION;
  }

  @Transactional(readOnly = true)
  String requirePendingInvoiceControlNumber(long tenantId, long invoiceId) {
    Invoice invoice = requireInvoice(tenantId, invoiceId);
    if (invoice.getSifenSubmissionStatus() != SifenSubmissionStatus.PENDING_VERIFICATION) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "SIFEN_INVOICE_NOT_PENDING_VERIFICATION");
    }
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

  /** AC-06: an invoice already Aprobado/Aprobado con observación can never be sent again. */
  private static void requireNotAlreadyApproved(Invoice invoice) {
    SifenSubmissionStatus status = invoice.getSifenSubmissionStatus();
    if (status == SifenSubmissionStatus.APPROVED
        || status == SifenSubmissionStatus.APPROVED_WITH_OBSERVATION) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "SIFEN_INVOICE_ALREADY_APPROVED");
    }
  }

  /**
   * AC-07: blocked only if this document was signed more than 72h ago AND has never actually
   * received a response from SIFEN before (a rejected-then-retried or pending-then-retried
   * submission this stale should go through HU-07's status check instead of a blind resend).
   */
  private static void requireWithinTransmissionWindow(
      Invoice invoice, LocalDateTime signedAt, LocalDateTime now) {
    boolean neverReceivedAResponse = invoice.getSifenSubmittedAt() == null;
    if (neverReceivedAResponse
        && Duration.between(signedAt, now).compareTo(SIGNATURE_TRANSMISSION_WINDOW) > 0) {
      throw new ResponseStatusException(HttpStatus.PRECONDITION_FAILED, "SIFEN_SIGNATURE_EXPIRED");
    }
  }
}
