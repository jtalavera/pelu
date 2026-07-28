package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.BusinessProfile;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.service.SifenCertificateService;
import com.cursorpoc.backend.web.dto.SifenCertificateUploadRequest;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.time.LocalDateTime;
import java.util.Base64;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Test-only support endpoint, gated behind the same {@code femme.data-init.enabled} flag as {@link
 * SeedResetController} (true only for the {@code e2e} Spring profile — see
 * application-e2e.properties). Never reachable in production, since that profile is never active
 * there.
 *
 * <p>SIFEN HU-07 AC-04's manual "check status" button only ever appears on an invoice the system
 * itself marked 'pendiente de verificación' after a real submission attempt to SIFEN got no
 * response (HU-06 AC-05). But nothing in the app calls {@code
 * SifenInvoiceSubmissionService.submit()} yet — tenant activation is HU-22, still pending (see
 * PROGRESS.md) — so no invoice can reach that state through real usage today. This endpoint
 * fabricates the full precondition (a valid certificate, a matching business RUC, and the invoice's
 * pending-verification state) directly, so Playwright can exercise the real button + real query
 * client end-to-end without depending on a live network call to SIFEN's real test environment
 * (undesirable in CI) or on HU-22.
 */
@RestController
@RequestMapping("/api/admin/sifen-test-support")
@ConditionalOnProperty(name = "femme.data-init.enabled", havingValue = "true")
public class SifenInvoiceTestSupportController {

  private static final Logger log =
      LoggerFactory.getLogger(SifenInvoiceTestSupportController.class);

  /**
   * A syntactically valid 44-char CDC for the real pilot RUC (same shape verified live against
   * sifen-test.set.gov.py during this story's manual verification, sección "Verificación en vivo"
   * of PROGRESS.md) — content doesn't matter here, only that {@code checkPendingStatus} has a
   * non-blank control number to send.
   */
  private static final String FIXTURE_CONTROL_NUMBER =
      "01011371528001001999990122026072811234567800";

  /** Embeds RUC 12345678-9 (sección "Certificado real y verificación en vivo" de HU-05). */
  private static final String FIXTURE_CERTIFICATE_RESOURCE = "/sifen/e2e-test-support-cert.p12";

  private static final String FIXTURE_CERTIFICATE_PASSWORD = "TestPass123!";
  private static final String FIXTURE_CERTIFICATE_RUC = "12345678-9";

  private final InvoiceRepository invoiceRepository;
  private final BusinessProfileRepository businessProfileRepository;
  private final TenantRepository tenantRepository;
  private final AppUserRepository appUserRepository;
  private final SifenCertificateService certificateService;

  public SifenInvoiceTestSupportController(
      InvoiceRepository invoiceRepository,
      BusinessProfileRepository businessProfileRepository,
      TenantRepository tenantRepository,
      AppUserRepository appUserRepository,
      SifenCertificateService certificateService) {
    this.invoiceRepository = invoiceRepository;
    this.businessProfileRepository = businessProfileRepository;
    this.tenantRepository = tenantRepository;
    this.appUserRepository = appUserRepository;
    this.certificateService = certificateService;
  }

  @PostMapping("/invoices/{id}/prepare-for-status-check")
  @Transactional
  public void prepareForStatusCheck(@PathVariable long id) {
    log.info("POST /api/admin/sifen-test-support/invoices/{}/prepare-for-status-check", id);
    Invoice invoice =
        invoiceRepository
            .findById(id)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "INVOICE_NOT_FOUND"));
    long tenantId = invoice.getTenant().getId();

    ensureBusinessRuc(tenantId);
    ensureValidCertificate(tenantId);

    invoice.setSifenControlNumber(FIXTURE_CONTROL_NUMBER);
    invoice.setSifenSignedAt(LocalDateTime.now());
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.PENDING_VERIFICATION);
  }

  private void ensureBusinessRuc(long tenantId) {
    BusinessProfile profile =
        businessProfileRepository.findByTenantId(tenantId).orElseGet(() -> createProfile(tenantId));
    profile.setRuc(FIXTURE_CERTIFICATE_RUC);
    businessProfileRepository.save(profile);
  }

  private BusinessProfile createProfile(long tenantId) {
    Tenant tenant =
        tenantRepository
            .findById(tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND"));
    BusinessProfile profile = new BusinessProfile();
    profile.setTenant(tenant);
    profile.setBusinessName(tenant.getName());
    return profile;
  }

  private void ensureValidCertificate(long tenantId) {
    AppUser uploader =
        appUserRepository
            .findFirstByTenant_IdOrderByIdAsc(tenantId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND"));
    String fileBase64 = Base64.getEncoder().encodeToString(readFixtureCertificateBytes());
    certificateService.upload(
        tenantId,
        uploader.getId(),
        new SifenCertificateUploadRequest(fileBase64, FIXTURE_CERTIFICATE_PASSWORD));
  }

  private static byte[] readFixtureCertificateBytes() {
    try (InputStream in =
        SifenInvoiceTestSupportController.class.getResourceAsStream(FIXTURE_CERTIFICATE_RESOURCE)) {
      if (in == null) {
        throw new IllegalStateException(
            "Missing classpath resource: " + FIXTURE_CERTIFICATE_RESOURCE);
      }
      return in.readAllBytes();
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }
}
