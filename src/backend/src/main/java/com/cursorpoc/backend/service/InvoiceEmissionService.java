package com.cursorpoc.backend.service;

import com.cursorpoc.backend.web.dto.InvoiceCreateRequest;
import com.cursorpoc.backend.web.dto.InvoiceResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * The single entry point that issues an invoice, with or without SIFEN: what {@code POST
 * /api/invoices} does, shared with the assistant's confirmed drafts so both take exactly the same
 * road (flag, certificate, mandatory recipient e-mail, traditional or SIFEN pipeline).
 */
@Service
public class InvoiceEmissionService {

  private static final Logger log = LoggerFactory.getLogger(InvoiceEmissionService.class);

  /**
   * SIFEN HU-22: the per-tenant switch between the SIFEN pipeline and the traditional generator.
   */
  public static final String SIFEN_ELECTRONIC_INVOICING_FLAG_KEY = "SIFEN_ELECTRONIC_INVOICING";

  private final InvoiceService invoiceService;
  private final InvoiceIssuanceService invoiceIssuanceService;
  private final FeatureFlagService featureFlagService;
  private final SifenCertificateService sifenCertificateService;

  public InvoiceEmissionService(
      InvoiceService invoiceService,
      InvoiceIssuanceService invoiceIssuanceService,
      FeatureFlagService featureFlagService,
      SifenCertificateService sifenCertificateService) {
    this.invoiceService = invoiceService;
    this.invoiceIssuanceService = invoiceIssuanceService;
    this.featureFlagService = featureFlagService;
    this.sifenCertificateService = sifenCertificateService;
  }

  public boolean isSifenEnabled(long tenantId) {
    return featureFlagService.isEnabled(SIFEN_ELECTRONIC_INVOICING_FLAG_KEY, tenantId);
  }

  /**
   * SIFEN HU-22 AC-03/AC-04: when enabled, a valid certificate is required BEFORE the invoice is
   * created (nothing is persisted if it throws). Issue #173: with SIFEN the KuDE is auto-emailed
   * after approval, so a recipient address is mandatory — except for a "Sin identificar" receiver.
   * RT-20: creation and signing run in one transaction ({@link
   * InvoiceIssuanceService#issueWithSifen}).
   */
  public InvoiceResponse issue(long tenantId, InvoiceCreateRequest request) {
    boolean sifenEnabled = isSifenEnabled(tenantId);
    if (sifenEnabled) {
      sifenCertificateService.requireActiveCertificate(tenantId);
      if (receiverWillBeIdentified(request) && isBlank(request.email())) {
        log.error("issue invoice tenantId={} status=400 SIFEN_RECIPIENT_EMAIL_REQUIRED", tenantId);
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SIFEN_RECIPIENT_EMAIL_REQUIRED");
      }
    }
    return sifenEnabled
        ? invoiceIssuanceService.issueWithSifen(tenantId, request)
        : invoiceService.issueInvoice(tenantId, request);
  }

  /**
   * Issue #173: mirrors {@code SifenInvoiceHeaderService.isReceiverUnidentified} on the request —
   * the receiver ends up identified iff a RUC or an identity-document override was sent (a linked
   * client's own profile data is never used as a fallback, per issue #96).
   */
  public static boolean receiverWillBeIdentified(InvoiceCreateRequest request) {
    return !isBlank(request.clientRucOverride())
        || !isBlank(request.clientIdentityDocumentOverride());
  }

  private static boolean isBlank(String value) {
    return value == null || value.isBlank();
  }
}
