package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.enums.SifenClientIdentificationType;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.util.ParaguayRucValidator;
import com.cursorpoc.backend.web.dto.InvoiceClientIdentificationRequest;
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
 * SIFEN HU-11: identifies the client on an already-approved invoice that was issued without one, by
 * registering a "Evento de Nominación" ({@code rGEveNom}) with SIFEN — the second
 * event-registration interaction in this integration (after HU-10's cancellation). Orchestrates
 * {@link SifenClientIdentificationEventXmlService} (build) + {@link
 * SifenDocumentSigningService#signEvent} (sign, reusing the same shared XML-DSig machinery HU-10
 * generalized) + {@link SifenEventClient} (send, the same client HU-10 built and this story
 * renamed/generalized) — the exact same orchestration shape as {@link
 * SifenInvoiceCancellationService}.
 *
 * <p><b>AC-01/AC-02/AC-03/AC-04 eligibility and field validation happen, and the request's audit
 * fields are persisted, in one short transaction before any network activity</b> — same rationale
 * as {@code SifenInvoiceCancellationService.prepareForCancellation}.
 *
 * <p><b>Unlike HU-10's cancellation, a successful identification does not change {@code
 * sifenSubmissionStatus}</b> — the invoice stays exactly as approved as it was; only {@code
 * sifenClientIdentified} flips (AC-01's gate) and the invoice's own client display fields ({@code
 * clientDisplayName}/{@code clientRucOverride}/{@code clientIdentityDocumentOverride}) are updated
 * to reflect the now-identified client, in addition to the dedicated {@code
 * sifen_client_identification_*} audit columns (AC-05) — so the rest of the app (KuDE, invoice
 * list, etc.) picks up the identified client without any of those call sites needing to know this
 * event exists.
 *
 * <p><b>Real live SIFEN verification note</b> (see PROGRESS.md's HU-11 section): same wall as HU-10
 * — no document this system has ever submitted reached genuine "Aprobado" status, so AC-05's happy
 * path (SIFEN approves the nomination) could not be exercised live end-to-end either. What was
 * verified live is {@link SifenEventClient} actually reaching the real event service with a
 * genuinely different event payload (the nomination event, not cancellation) and parsing a real
 * rejection-shaped response for AC-06's error-handling path — the same {@code 0160 "XML mal
 * formado"} wall HU-10 hit reproduced here too, confirming it's a property of the shared event
 * envelope/signing path, not something specific to the cancellation event's own shape.
 */
@Service
public class SifenInvoiceClientIdentificationService {

  private static final Logger log =
      LoggerFactory.getLogger(SifenInvoiceClientIdentificationService.class);

  /**
   * Real finding, confirmed live: SIFEN's own test sandbox clock runs measurably behind real UTC
   * (see {@code SifenInvoiceSubmissionPersistenceService}'s own javadoc for the diagnosis) — an
   * event's declared signature date/time needs this same margin, or SIFEN rejects it as being ahead
   * of its own clock. Applied only to the value used as the event's signature timestamp — the audit
   * fields persisted below intentionally keep the true, unbuffered now.
   */
  private static final Duration SIFEN_CLOCK_SKEW_BUFFER = Duration.ofMinutes(2);

  private final InvoiceRepository invoiceRepository;
  private final SifenInvoiceHeaderService headerService;
  private final SifenClientIdentificationEventXmlService eventXmlService;
  private final SifenDocumentSigningService signingService;
  private final SifenEventClient eventClient;
  private final FemmeTimeProperties timeProperties;

  /**
   * Self-injected proxy — required so {@link #identifyClient}'s calls to {@link
   * #prepareForIdentification}/{@link #recordIdentificationResult} go through Spring's
   * transactional proxy instead of a raw {@code this.} self-invocation (which silently skips
   * {@code @Transactional} entirely, per Spring AOP's documented limitation). Found live during
   * this story: a plain {@code this.} call left {@code prepareForIdentification} running with no
   * active session at all, surfacing as {@code LazyInitializationException} the first time this
   * codebase's event-orchestration pattern (established by {@code SifenInvoiceCancellationService},
   * HU-10) needed to lazily resolve a related entity ({@code Invoice.client}) — HU-10's own
   * equivalent method never touches a lazy association, so its identical self-invocation gap has
   * stayed latent and never manifested there. Field-injected (not a constructor param) so plain
   * unit tests that construct this class directly (no Spring context) keep working unchanged —
   * {@link #self()} falls back to {@code this} whenever Spring never set it. {@code @Lazy} avoids a
   * circular-construction failure at real startup (this bean would otherwise need itself before it
   * exists).
   */
  @Autowired @Lazy private SifenInvoiceClientIdentificationService selfProxy;

  public SifenInvoiceClientIdentificationService(
      InvoiceRepository invoiceRepository,
      SifenInvoiceHeaderService headerService,
      SifenClientIdentificationEventXmlService eventXmlService,
      SifenDocumentSigningService signingService,
      SifenEventClient eventClient,
      FemmeTimeProperties timeProperties) {
    this.invoiceRepository = invoiceRepository;
    this.headerService = headerService;
    this.eventXmlService = eventXmlService;
    this.signingService = signingService;
    this.eventClient = eventClient;
    this.timeProperties = timeProperties;
  }

  private SifenInvoiceClientIdentificationService self() {
    return selfProxy != null ? selfProxy : this;
  }

  /**
   * AC-01..AC-04: validates eligibility and the submitted fields, records the attempt, builds+signs
   * +sends the nomination event, then persists SIFEN's result — AC-05 (approved: client data
   * recorded, both in the audit columns and on the invoice's own display fields) or AC-06
   * (rejected: rejection reason recorded, invoice left exactly as it was). Throws {@code
   * SIFEN_CLIENT_IDENTIFICATION_NO_RESPONSE} (502) if SIFEN never answers.
   */
  public SifenSubmissionResult identifyClient(
      long tenantId,
      long invoiceId,
      long userId,
      String userEmail,
      InvoiceClientIdentificationRequest request) {
    IdentificationRequest prepared =
        self().prepareForIdentification(tenantId, invoiceId, userId, userEmail, request);

    Document unsigned =
        eventXmlService.buildClientIdentificationEvent(
            prepared.cdc(), prepared.data(), prepared.eventId(), prepared.signedAt());
    Document signed = signingService.signEvent(tenantId, unsigned);
    String xml = SifenDocumentXmlService.serialize(signed);

    Optional<SifenSubmissionResult> response = eventClient.send(tenantId, xml);
    if (response.isEmpty()) {
      log.error(
          "SIFEN client identification got no response tenantId={} invoiceId={} controlNumber={}",
          tenantId,
          invoiceId,
          prepared.cdc());
      throw new ResponseStatusException(
          HttpStatus.BAD_GATEWAY, "SIFEN_CLIENT_IDENTIFICATION_NO_RESPONSE");
    }

    SifenSubmissionResult result = response.get();
    self().recordIdentificationResult(tenantId, invoiceId, result);
    log.info(
        "SIFEN client identification resolved tenantId={} invoiceId={} controlNumber={} status={}",
        tenantId,
        invoiceId,
        prepared.cdc(),
        result.status());
    return result;
  }

  @Transactional
  IdentificationRequest prepareForIdentification(
      long tenantId,
      long invoiceId,
      long userId,
      String userEmail,
      InvoiceClientIdentificationRequest request) {
    Invoice invoice = requireInvoice(tenantId, invoiceId);
    requireEligible(invoice);
    String cdc = requireControlNumber(invoice);
    SifenClientIdentificationEventXmlService.ClientIdentificationData data =
        validateAndBuildData(request);

    LocalDateTime now = LocalDateTime.now(timeProperties.zoneId());
    invoice.setSifenClientIdentificationRequestedAt(now);
    invoice.setSifenClientIdentificationRequestedByUserId(userId);
    invoice.setSifenClientIdentificationRequestedByEmail(userEmail);
    invoice.setSifenClientIdentificationClientType(data.clientType().name());
    invoice.setSifenClientIdentificationRuc(data.ruc());
    invoice.setSifenClientIdentificationIdentityDocument(data.identityDocumentNumber());
    invoice.setSifenClientIdentificationName(data.name());
    invoice.setSifenClientIdentificationAddress(data.address());
    invoice.setSifenClientIdentificationCountryCode(data.countryCode());

    // rEve's own Id attribute — epoch seconds, same rationale as SifenCancellationEventXmlService's
    // (tdIdEve is 1-10 digits; epoch millis would already overflow it).
    long eventId = Instant.now().getEpochSecond();
    return new IdentificationRequest(cdc, data, eventId, now.minus(SIFEN_CLOCK_SKEW_BUFFER));
  }

  @Transactional
  void recordIdentificationResult(long tenantId, long invoiceId, SifenSubmissionResult result) {
    Invoice invoice = requireInvoice(tenantId, invoiceId);
    invoice.setSifenClientIdentificationResultCode(result.resultCode());
    invoice.setSifenClientIdentificationMessage(result.message());
    invoice.setSifenClientIdentificationProtocolNumber(result.protocolNumber());
    // AC-05: only a genuinely SIFEN-approved event marks the invoice identified and updates its
    // visible client fields. AC-06: any other outcome leaves both untouched — another attempt
    // remains possible (AC-01 isn't a one-shot lock, unlike HU-10's CANCELLED transition).
    if (result.status() == SifenSubmissionStatus.APPROVED
        || result.status() == SifenSubmissionStatus.APPROVED_WITH_OBSERVATION) {
      invoice.setSifenClientIdentified(true);
      invoice.setClientDisplayName(invoice.getSifenClientIdentificationName());
      invoice.setClientRucOverride(invoice.getSifenClientIdentificationRuc());
      invoice.setClientIdentityDocumentOverride(
          invoice.getSifenClientIdentificationIdentityDocument());
    }
  }

  /** AC-01: only an eligible invoice — approved, issued without client data, not yet identified. */
  private void requireEligible(Invoice invoice) {
    SifenSubmissionStatus status = invoice.getSifenSubmissionStatus();
    if (status != SifenSubmissionStatus.APPROVED
        && status != SifenSubmissionStatus.APPROVED_WITH_OBSERVATION) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "SIFEN_INVOICE_NOT_APPROVED");
    }
    if (invoice.isSifenClientIdentified()) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "SIFEN_INVOICE_CLIENT_ALREADY_IDENTIFIED");
    }
    if (!headerService.isReceiverUnidentified(invoice)) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "SIFEN_INVOICE_CLIENT_ALREADY_IDENTIFIED");
    }
  }

  /**
   * AC-02/AC-03/AC-04: shape and validate the submitted fields per the chosen client type. Returns
   * a fully-populated {@code ClientIdentificationData}, never partially valid.
   */
  private static SifenClientIdentificationEventXmlService.ClientIdentificationData
      validateAndBuildData(InvoiceClientIdentificationRequest request) {
    if (request.clientType() == null) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "SIFEN_CLIENT_IDENTIFICATION_TYPE_REQUIRED");
    }
    String name = request.name() == null ? null : request.name().trim();
    if (name == null || name.isBlank()) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "SIFEN_CLIENT_IDENTIFICATION_NAME_REQUIRED");
    }

    switch (request.clientType()) {
      case COMPANY -> {
        // AC-03: a company requires a RUC in a correct format.
        if (!ParaguayRucValidator.isValid(request.ruc())) {
          throw new ResponseStatusException(
              HttpStatus.BAD_REQUEST, "SIFEN_CLIENT_IDENTIFICATION_RUC_INVALID");
        }
        return new SifenClientIdentificationEventXmlService.ClientIdentificationData(
            SifenClientIdentificationType.COMPANY, request.ruc().trim(), null, name, null, null);
      }
      case PERSON -> {
        String doc = trimmedOrNull(request.identityDocumentNumber());
        String ruc = trimmedOrNull(request.ruc());
        if (ruc == null && doc == null) {
          throw new ResponseStatusException(
              HttpStatus.BAD_REQUEST, "SIFEN_CLIENT_IDENTIFICATION_DOCUMENT_REQUIRED");
        }
        if (ruc != null && !ParaguayRucValidator.isValid(ruc)) {
          throw new ResponseStatusException(
              HttpStatus.BAD_REQUEST, "SIFEN_CLIENT_IDENTIFICATION_RUC_INVALID");
        }
        return new SifenClientIdentificationEventXmlService.ClientIdentificationData(
            SifenClientIdentificationType.PERSON, ruc, ruc == null ? doc : null, name, null, null);
      }
      case FOREIGN -> {
        // AC-04: a foreign client also requires an address, plus a country from the supported list.
        String address = trimmedOrNull(request.address());
        if (address == null) {
          throw new ResponseStatusException(
              HttpStatus.BAD_REQUEST, "SIFEN_CLIENT_IDENTIFICATION_ADDRESS_REQUIRED");
        }
        String countryCode = trimmedOrNull(request.countryCode());
        if (countryCode == null || SifenForeignCountry.fromCode(countryCode).isEmpty()) {
          throw new ResponseStatusException(
              HttpStatus.BAD_REQUEST, "SIFEN_CLIENT_IDENTIFICATION_COUNTRY_INVALID");
        }
        String doc = trimmedOrNull(request.identityDocumentNumber());
        String ruc = trimmedOrNull(request.ruc());
        if (ruc == null && doc == null) {
          throw new ResponseStatusException(
              HttpStatus.BAD_REQUEST, "SIFEN_CLIENT_IDENTIFICATION_DOCUMENT_REQUIRED");
        }
        if (ruc != null && !ParaguayRucValidator.isValid(ruc)) {
          throw new ResponseStatusException(
              HttpStatus.BAD_REQUEST, "SIFEN_CLIENT_IDENTIFICATION_RUC_INVALID");
        }
        return new SifenClientIdentificationEventXmlService.ClientIdentificationData(
            SifenClientIdentificationType.FOREIGN,
            ruc,
            ruc == null ? doc : null,
            name,
            address,
            countryCode.toUpperCase());
      }
    }
    throw new IllegalStateException(
        "Unreachable — all SifenClientIdentificationType cases handled");
  }

  private static String trimmedOrNull(String s) {
    if (s == null) {
      return null;
    }
    String trimmed = s.trim();
    return trimmed.isEmpty() ? null : trimmed;
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

  private record IdentificationRequest(
      String cdc,
      SifenClientIdentificationEventXmlService.ClientIdentificationData data,
      long eventId,
      LocalDateTime signedAt) {}
}
