package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.BusinessProfile;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.domain.enums.SifenTaxpayerType;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.repository.SifenCertificateRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.service.SifenCertificateService;
import com.cursorpoc.backend.service.SifenInvoiceDetail;
import com.cursorpoc.backend.service.SifenInvoiceDetailService;
import com.cursorpoc.backend.service.SifenInvoiceHeader;
import com.cursorpoc.backend.service.SifenInvoiceHeaderService;
import com.cursorpoc.backend.service.SifenQrCodeService;
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
 *
 * <p>{@link #clearCertificates()} additionally supports SIFEN HU-19 (certificate listing) — see its
 * own javadoc.
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

  /** Same demo tenant id hardcoded by {@code SeedResetService}. */
  private static final long DEMO_TENANT_ID = 1L;

  private final InvoiceRepository invoiceRepository;
  private final BusinessProfileRepository businessProfileRepository;
  private final TenantRepository tenantRepository;
  private final AppUserRepository appUserRepository;
  private final SifenCertificateService certificateService;
  private final SifenCertificateRepository certificateRepository;
  private final SifenInvoiceHeaderService headerService;
  private final SifenInvoiceDetailService detailService;
  private final SifenQrCodeService qrCodeService;

  public SifenInvoiceTestSupportController(
      InvoiceRepository invoiceRepository,
      BusinessProfileRepository businessProfileRepository,
      TenantRepository tenantRepository,
      AppUserRepository appUserRepository,
      SifenCertificateService certificateService,
      SifenCertificateRepository certificateRepository,
      SifenInvoiceHeaderService headerService,
      SifenInvoiceDetailService detailService,
      SifenQrCodeService qrCodeService) {
    this.invoiceRepository = invoiceRepository;
    this.businessProfileRepository = businessProfileRepository;
    this.tenantRepository = tenantRepository;
    this.appUserRepository = appUserRepository;
    this.certificateService = certificateService;
    this.certificateRepository = certificateRepository;
    this.headerService = headerService;
    this.detailService = detailService;
    this.qrCodeService = qrCodeService;
  }

  /**
   * SIFEN HU-19 AC-05's empty-state Playwright test needs the demo tenant's certificate list to be
   * provably empty, but other SIFEN e2e specs (HU-07, HU-18, HU-20) upload certificates into the
   * same shared demo tenant and never clean up after themselves (by design — they only ever assert
   * relative counts, e.g. {@code countBefore + 1}, never an absolute zero). Since Playwright spec
   * file execution order isn't guaranteed, HU-19's empty-state test calls this first to reset to a
   * known-zero state; it never assumes other tests won't run afterward, and no other SIFEN e2e spec
   * asserts an absolute starting count, so clearing here doesn't break them.
   */
  @PostMapping("/certificates/clear")
  @Transactional
  public void clearCertificates() {
    log.info("POST /api/admin/sifen-test-support/certificates/clear tenantId={}", DEMO_TENANT_ID);
    certificateRepository.deleteAll(
        certificateRepository.findByTenant_IdOrderByUploadedAtDesc(DEMO_TENANT_ID));
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

  /**
   * SIFEN HU-08: fabricates a fully "Aprobado" invoice — the precondition Playwright needs to
   * exercise the KuDE download (AC-16) and email-send (AC-17) buttons end-to-end, since nothing in
   * the app calls {@code SifenInvoiceSubmissionService.submit()} yet (tenant activation is HU-22).
   * Builds the header/detail/QR the exact same way the real submission flow would (real {@link
   * SifenInvoiceHeaderService}/{@link SifenInvoiceDetailService}/{@link SifenQrCodeService}, no
   * shortcuts) — only the signature itself and the actual SIFEN round-trip are skipped, since
   * neither is needed to prove the KuDE renders/downloads/emails correctly from real, valid data.
   */
  @PostMapping("/invoices/{id}/prepare-as-approved")
  @Transactional
  public void prepareAsApproved(@PathVariable long id) {
    log.info("POST /api/admin/sifen-test-support/invoices/{}/prepare-as-approved", id);
    prepareWithQrAndStatus(id, SifenSubmissionStatus.APPROVED);
  }

  /**
   * SIFEN HU-09 AC-05: the revalidate button must not be gated to "Aprobado"/"Aprobado con
   * observación" only, since it also has to keep working once a cancelled state exists (Fase 3, not
   * built yet). This lets Playwright fabricate an invoice with a persisted QR/verification URL
   * under a status other than APPROVED — {@code REJECTED} here, the closest already-existing
   * "terminal, non-approved" status — to prove the button's visibility really only depends on the
   * URL being present, not on the status value. Shares the exact same QR-building path as {@link
   * #prepareAsApproved(long)}.
   */
  @PostMapping("/invoices/{id}/prepare-with-status/{status}")
  @Transactional
  public void prepareWithStatus(@PathVariable long id, @PathVariable SifenSubmissionStatus status) {
    log.info("POST /api/admin/sifen-test-support/invoices/{}/prepare-with-status/{}", id, status);
    prepareWithQrAndStatus(id, status);
  }

  private void prepareWithQrAndStatus(long id, SifenSubmissionStatus status) {
    Invoice invoice =
        invoiceRepository
            .findById(id)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "INVOICE_NOT_FOUND"));
    long tenantId = invoice.getTenant().getId();

    ensureFullIssuerData(tenantId);

    SifenInvoiceHeader header = headerService.buildHeader(tenantId, id);
    SifenInvoiceDetail detail = detailService.buildDetail(tenantId, id);
    // A syntactically valid base64 placeholder — no real signature exists in this fabricated path
    // (see javadoc above), so there's no real DigestValue to reuse; the QR only needs to be a
    // realistic, correctly-hashed URL for the PDF/email flow to exercise, not one SIFEN itself
    // would recognize.
    SifenQrCodeService.SifenQrResult qr =
        qrCodeService.build(header, detail.totals(), detail.lines().size(), "ZmFrZURpZ2VzdA==");

    invoice.setSifenSignedAt(LocalDateTime.now());
    invoice.setSifenSubmissionStatus(status);
    invoice.setSifenSubmissionProtocolNumber("123456789");
    invoice.setSifenSubmittedAt(LocalDateTime.now());
    invoice.setSifenQrUrl(qr.qrUrl());
    invoice.setSifenPublicConsultationUrl(qr.publicConsultationUrl());
  }

  private void ensureFullIssuerData(long tenantId) {
    BusinessProfile profile =
        businessProfileRepository.findByTenantId(tenantId).orElseGet(() -> createProfile(tenantId));
    profile.setRuc(FIXTURE_CERTIFICATE_RUC);
    profile.setAddress("Avda. España 123");
    profile.setTaxpayerType(SifenTaxpayerType.LEGAL_ENTITY);
    profile.setEconomicActivityCode("96020");
    profile.setEconomicActivityDescription("Peluquería y otros tratamientos de belleza");
    profile.setPhone("021555000");
    profile.setContactEmail("facturacion@example.com");
    profile.setSifenDepartmentCode("11");
    profile.setSifenDepartmentName("CENTRAL");
    profile.setSifenCityCode("3432");
    profile.setSifenCityName("FERNANDO DE LA MORA");
    businessProfileRepository.save(profile);
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
