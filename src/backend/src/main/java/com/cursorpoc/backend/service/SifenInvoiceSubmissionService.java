package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.repository.InvoiceRepository;
import java.time.Duration;
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
 * SIFEN HU-06: sends a document firmado (HU-04) to SIFEN's synchronous reception service ({@link
 * SifenDocumentReceptionClient}) and registers the result on the invoice. SIFEN HU-07: also queries
 * SIFEN directly ({@link SifenDocumentQueryClient}) for the real status of an invoice this system
 * marked 'pendiente de verificación' — both the manual trigger (AC-04, a controller calls {@link
 * #checkPendingStatus}) and the automatic one (AC-05, {@link #submit} checks first before blindly
 * resending).
 *
 * <p>Sin endpoint HTTP ni pantalla propia todavía para el envío en sí — ninguna AC de HU-06 pide un
 * disparador manual; la activación real por tenant y el enrutamiento desde el flujo normal de
 * emisión son HU-22 (Fase 5), que todavía no existe. Mismo patrón que HU-01/02/03/04/05/21:
 * capacidad de servicio consumida por historias futuras. HU-07 sí tiene un controller propio
 * ({@code InvoiceController}) para {@link #checkPendingStatus} — ver PROGRESS.md.
 *
 * <p>Dos transacciones separadas, no una sola envolviendo todo el método: la llamada de red a SIFEN
 * puede tardar (hasta 30s de timeout) y no debe mantener abierta una conexión/transacción de base
 * de datos mientras tanto. La primera transacción resuelve y persiste {@code sifenSignedAt} *antes*
 * de firmar/enviar, para que sobreviva aunque el proceso se caiga a mitad del envío (AC-07 necesita
 * ese instante para sobrevivir a un reintento).
 */
@Service
public class SifenInvoiceSubmissionService {

  private static final Logger log = LoggerFactory.getLogger(SifenInvoiceSubmissionService.class);

  /**
   * AC-07: Manual Técnico V150 ("La transmisión del DE firmado digitalmente contempla un plazo de
   * hasta 72 horas posteriores a la firma digital") — no es una regla propia, es la ventana real
   * que SIFEN exige.
   */
  static final Duration SIGNATURE_TRANSMISSION_WINDOW = Duration.ofHours(72);

  private final InvoiceRepository invoiceRepository;
  private final SifenDocumentSigningService signingService;
  private final SifenDocumentReceptionClient receptionClient;
  private final SifenDocumentQueryClient queryClient;
  private final FemmeTimeProperties timeProperties;

  public SifenInvoiceSubmissionService(
      InvoiceRepository invoiceRepository,
      SifenDocumentSigningService signingService,
      SifenDocumentReceptionClient receptionClient,
      SifenDocumentQueryClient queryClient,
      FemmeTimeProperties timeProperties) {
    this.invoiceRepository = invoiceRepository;
    this.signingService = signingService;
    this.receptionClient = receptionClient;
    this.queryClient = queryClient;
    this.timeProperties = timeProperties;
  }

  public SifenSubmissionResult submit(long tenantId, long invoiceId) {
    // HU-07 AC-05: a pending-verification invoice gets queried first, instead of blindly resending
    // the same document — only fall through to a fresh submission attempt below if SIFEN still
    // gives no answer (still ambiguous).
    if (isPendingVerification(tenantId, invoiceId)) {
      Optional<SifenSubmissionResult> resolved = checkPendingStatus(tenantId, invoiceId);
      if (resolved.isPresent()) {
        return resolved.get();
      }
    }

    LocalDateTime signedAt = prepareForSubmission(tenantId, invoiceId);

    SifenSignedDocument signed = signingService.signInvoice(tenantId, invoiceId, signedAt);
    Document document = signed.document();
    String xml = SifenDocumentXmlService.serialize(document);

    // SIFEN HU-08: persisted regardless of what SIFEN answers below — the QR is a property of the
    // document actually transmitted, not of SIFEN's response to it (AC-11's "sent invoice" data).
    persistQrData(tenantId, invoiceId, signed.qrUrl(), signed.publicConsultationUrl());

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

    recordResult(tenantId, invoiceId, result, response.isPresent(), null);

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
      signedAt = now;
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

  /**
   * HU-07 AC-01/AC-02/AC-03/AC-04: queries SIFEN directly for the real status of an invoice this
   * system marked 'pendiente de verificación'. Returns {@link Optional#empty()} — and leaves the
   * invoice untouched — if SIFEN still gives no interpretable answer; otherwise the invoice's
   * status (and, for AC-03, its full document content when found) is persisted and the resolved
   * result returned. Throws {@code SIFEN_INVOICE_NOT_PENDING_VERIFICATION} (409) if called on an
   * invoice that isn't currently pending verification — this check only ever makes sense for one.
   */
  public Optional<SifenSubmissionResult> checkPendingStatus(long tenantId, long invoiceId) {
    String cdc = requirePendingInvoiceControlNumber(tenantId, invoiceId);

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
    recordResult(tenantId, invoiceId, result.submissionResult(), true, result.documentContent());
    log.info(
        "SIFEN status check resolved tenantId={} invoiceId={} controlNumber={} status={}",
        tenantId,
        invoiceId,
        cdc,
        result.submissionResult().status());
    return Optional.of(result.submissionResult());
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
