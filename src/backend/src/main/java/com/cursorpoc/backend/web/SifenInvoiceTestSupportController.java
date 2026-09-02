package com.cursorpoc.backend.web;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.BusinessProfile;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.SifenNumberVoidingEvent;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.domain.enums.SifenNumberVoidingStatus;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.domain.enums.SifenTaxpayerType;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.repository.SifenCertificateRepository;
import com.cursorpoc.backend.repository.SifenNumberVoidingEventRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.service.SifenCertificateSecretStore;
import com.cursorpoc.backend.service.SifenCertificateService;
import com.cursorpoc.backend.service.SifenInvoiceDetail;
import com.cursorpoc.backend.service.SifenInvoiceDetailService;
import com.cursorpoc.backend.service.SifenInvoiceHeader;
import com.cursorpoc.backend.service.SifenInvoiceHeaderService;
import com.cursorpoc.backend.service.SifenInvoiceNotificationService;
import com.cursorpoc.backend.service.SifenNumberVoidingService;
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
  private final SifenCertificateSecretStore certificateSecretStore;
  private final SifenInvoiceHeaderService headerService;
  private final SifenInvoiceDetailService detailService;
  private final SifenQrCodeService qrCodeService;
  private final SifenNumberVoidingService numberVoidingService;
  private final SifenNumberVoidingEventRepository numberVoidingEventRepository;
  private final FemmeTimeProperties timeProperties;
  private final SifenInvoiceNotificationService notificationService;

  public SifenInvoiceTestSupportController(
      InvoiceRepository invoiceRepository,
      BusinessProfileRepository businessProfileRepository,
      TenantRepository tenantRepository,
      AppUserRepository appUserRepository,
      SifenCertificateService certificateService,
      SifenCertificateRepository certificateRepository,
      SifenCertificateSecretStore certificateSecretStore,
      SifenInvoiceHeaderService headerService,
      SifenInvoiceDetailService detailService,
      SifenQrCodeService qrCodeService,
      SifenNumberVoidingService numberVoidingService,
      SifenNumberVoidingEventRepository numberVoidingEventRepository,
      FemmeTimeProperties timeProperties,
      SifenInvoiceNotificationService notificationService) {
    this.invoiceRepository = invoiceRepository;
    this.businessProfileRepository = businessProfileRepository;
    this.tenantRepository = tenantRepository;
    this.appUserRepository = appUserRepository;
    this.certificateService = certificateService;
    this.certificateRepository = certificateRepository;
    this.certificateSecretStore = certificateSecretStore;
    this.headerService = headerService;
    this.detailService = detailService;
    this.qrCodeService = qrCodeService;
    this.numberVoidingService = numberVoidingService;
    this.numberVoidingEventRepository = numberVoidingEventRepository;
    this.timeProperties = timeProperties;
    this.notificationService = notificationService;
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
    // RT-12: the .p12/password themselves live in the secret store, not the DB row above — clear
    // those too so a re-run doesn't accumulate orphaned local files across the same demo tenant.
    certificateSecretStore.deleteAll(DEMO_TENANT_ID);
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
   * SIFEN HU-11: real signing (used by "flujo real end-to-end" Playwright tests, e.g. HU-10's own
   * cancellation and HU-11's client identification) requires a valid certificate for the tenant —
   * normally seeded incidentally by other SIFEN e2e specs (HU-07/HU-18/HU-20) that run earlier in
   * the same shared H2 instance, per HU-19's own documented caveat about execution-order
   * dependence. Running a single spec file in isolation doesn't get that seeding for free, so this
   * standalone endpoint lets any spec ensure one exists on its own, without the unrelated side
   * effects {@link #prepareForStatusCheck} also has (control number/status changes).
   */
  @PostMapping("/ensure-valid-certificate")
  @Transactional
  public void ensureValidCertificateForDemoTenant() {
    log.info(
        "POST /api/admin/sifen-test-support/ensure-valid-certificate tenantId={}", DEMO_TENANT_ID);
    ensureValidCertificate(DEMO_TENANT_ID);
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

  /**
   * SIFEN HU-10 AC-02: lets Playwright fabricate an invoice approved {@code hoursAgo} hours in the
   * past — both within the 48h cancellation window (a small value) and past it (a value &gt; 48) —
   * without waiting on a real clock. Shares the same real header/detail/QR-building path as {@link
   * #prepareAsApproved(long)}.
   */
  @PostMapping("/invoices/{id}/prepare-with-status-hours-ago/{status}/{hoursAgo}")
  @Transactional
  public void prepareWithStatusHoursAgo(
      @PathVariable long id,
      @PathVariable SifenSubmissionStatus status,
      @PathVariable long hoursAgo) {
    log.info(
        "POST /api/admin/sifen-test-support/invoices/{}/prepare-with-status-hours-ago/{}/{}",
        id,
        status,
        hoursAgo);
    prepareWithQrAndStatus(id, status);
    Invoice invoice =
        invoiceRepository
            .findById(id)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "INVOICE_NOT_FOUND"));
    // Issue #145: zoned consistently with how the real submission flow
    // (SifenDocumentReceptionClient)
    // and the cancellation eligibility check (SifenInvoiceCancellationService) both compute "now" —
    // a bare LocalDateTime.now() here would drift from the business zone by the JVM's default-zone
    // offset, corrupting any fabricated hoursAgo value close to SifenInvoiceCancellationService's
    // MINIMUM_CANCELLATION_DELAY window.
    invoice.setSifenSubmittedAt(LocalDateTime.now(timeProperties.zoneId()).minusHours(hoursAgo));
  }

  /**
   * SIFEN HU-10 AC-03/AC-04/AC-05: fabricates the result of a cancellation attempt directly — since
   * this system has never reached a real "Aprobado" DE to genuinely cancel (see PROGRESS.md), this
   * lets Playwright exercise the resulting UI (badge, audit fields, rejection message) for both
   * outcomes without depending on a live SIFEN round-trip. {@code approved=true} moves the invoice
   * to {@code CANCELLED} (AC-03); {@code approved=false} records the rejection but leaves the
   * invoice's current status untouched (AC-04) — mirroring exactly what {@code
   * SifenInvoiceCancellationService.recordCancellationResult} does with a real SIFEN response.
   */
  @PostMapping("/invoices/{id}/fabricate-cancellation-result/{approved}")
  @Transactional
  public void fabricateCancellationResult(@PathVariable long id, @PathVariable boolean approved) {
    log.info(
        "POST /api/admin/sifen-test-support/invoices/{}/fabricate-cancellation-result/{}",
        id,
        approved);
    Invoice invoice =
        invoiceRepository
            .findById(id)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "INVOICE_NOT_FOUND"));
    invoice.setSifenCancellationRequestedAt(LocalDateTime.now());
    invoice.setSifenCancellationRequestedByUserId(1L);
    invoice.setSifenCancellationRequestedByEmail("isabelzymanscki@gmail.com");
    invoice.setSifenCancellationReason("Error en el monto facturado al cliente");
    if (approved) {
      invoice.setSifenCancellationResultCode("0600");
      invoice.setSifenCancellationMessage("Evento registrado correctamente");
      invoice.setSifenCancellationProtocolNumber("987654321");
      invoice.setSifenSubmissionStatus(SifenSubmissionStatus.CANCELLED);
      // Issue #145: mirrors SifenInvoiceCancellationService.recordCancellationResult, which also
      // voids the invoice record on a successful SIFEN cancellation.
      invoice.setStatus(InvoiceStatus.VOIDED);
      invoice.setVoidReason(invoice.getSifenCancellationReason());
    } else {
      invoice.setSifenCancellationResultCode("4009");
      invoice.setSifenCancellationMessage(
          "Plazo de solicitud de cancelación de una FE extemporáneo");
    }
  }

  /**
   * Issue #173 item 2: e2e points SIFEN at an unreachable port, so the real submission listener
   * never sees an Aprobado result and never fires the KuDE auto-email. This calls the real trigger
   * ({@link SifenInvoiceNotificationService#emailKudeAfterApproval}) directly against a
   * fabricated-approved invoice so Playwright can assert the observable outcome (the invoice's
   * {@code sifenKudeEmailedAt} timestamp — the email itself is disabled/logged in e2e).
   */
  @PostMapping("/invoices/{id}/run-approval-notifications")
  public void runApprovalNotifications(@PathVariable long id) {
    log.info("POST /api/admin/sifen-test-support/invoices/{}/run-approval-notifications", id);
    notificationService.emailKudeAfterApproval(DEMO_TENANT_ID, id);
  }

  /**
   * Issue #173 item 3: same rationale as {@link #runApprovalNotifications(long)} — calls the real
   * trigger ({@link SifenInvoiceNotificationService#emailCancellationNotice}) directly so
   * Playwright can assert the {@code sifenCancellationNotifiedAt} timestamp after a fabricated
   * cancellation.
   */
  @PostMapping("/invoices/{id}/run-cancellation-notifications")
  public void runCancellationNotifications(@PathVariable long id) {
    log.info("POST /api/admin/sifen-test-support/invoices/{}/run-cancellation-notifications", id);
    notificationService.emailCancellationNotice(DEMO_TENANT_ID, id);
  }

  /**
   * SIFEN HU-11 AC-05/AC-06: fabricates the result of a client-identification attempt directly —
   * same rationale as {@link #fabricateCancellationResult(long, boolean)}, since this system has
   * never reached a real "Aprobado" DE to genuinely identify a client on. {@code approved=true}
   * marks the invoice identified and updates its client fields (AC-05); {@code approved=false}
   * records the rejection but leaves both untouched (AC-06) — mirroring exactly what {@code
   * SifenInvoiceClientIdentificationService.recordIdentificationResult} does with a real SIFEN
   * response.
   */
  @PostMapping("/invoices/{id}/fabricate-client-identification-result/{approved}")
  @Transactional
  public void fabricateClientIdentificationResult(
      @PathVariable long id, @PathVariable boolean approved) {
    log.info(
        "POST /api/admin/sifen-test-support/invoices/{}/fabricate-client-identification-result/{}",
        id,
        approved);
    Invoice invoice =
        invoiceRepository
            .findById(id)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "INVOICE_NOT_FOUND"));
    invoice.setSifenClientIdentificationRequestedAt(LocalDateTime.now());
    invoice.setSifenClientIdentificationRequestedByUserId(1L);
    invoice.setSifenClientIdentificationRequestedByEmail("isabelzymanscki@gmail.com");
    invoice.setSifenClientIdentificationClientType("PERSON");
    invoice.setSifenClientIdentificationName("María Fernanda Duarte");
    invoice.setSifenClientIdentificationIdentityDocument("4123456");
    if (approved) {
      invoice.setSifenClientIdentificationResultCode("0600");
      invoice.setSifenClientIdentificationMessage("Evento registrado correctamente");
      invoice.setSifenClientIdentificationProtocolNumber("123123123");
      invoice.setSifenClientIdentified(true);
      invoice.setClientDisplayName(invoice.getSifenClientIdentificationName());
      invoice.setClientIdentityDocumentOverride(
          invoice.getSifenClientIdentificationIdentityDocument());
    } else {
      invoice.setSifenClientIdentificationResultCode("4520");
      invoice.setSifenClientIdentificationMessage("Datos del receptor inconsistentes");
    }
  }

  /**
   * RT-25 (Hardening_SIFEN.md): fabricates a rejected transmit outcome and calls the real trigger
   * ({@code SifenNumberVoidingService.recordPendingForRejectedInvoice}) directly — this system has
   * never reached a real SIFEN rejection through the async queue in {@code e2e} (application-e2e's
   * SIFEN endpoint is unreachable, so a real attempt always lands in {@code PENDING_VERIFICATION},
   * never {@code REJECTED}), so Playwright can't drive this through {@code
   * SifenSubmissionQueueListener} itself. That wiring (listener calls the trigger only for {@code
   * REJECTED}) is covered at the unit level in {@code SifenSubmissionQueueListenerTest} instead;
   * this endpoint exercises the trigger's own real logic (idempotency, deadline computation,
   * persistence) end to end.
   */
  @PostMapping("/invoices/{id}/simulate-sifen-rejection")
  @Transactional
  public void simulateSifenRejection(@PathVariable long id) {
    log.info("POST /api/admin/sifen-test-support/invoices/{}/simulate-sifen-rejection", id);
    prepareWithQrAndStatus(id, SifenSubmissionStatus.REJECTED);
    Invoice invoice =
        invoiceRepository
            .findById(id)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "INVOICE_NOT_FOUND"));
    numberVoidingService.recordPendingForRejectedInvoice(invoice.getTenant().getId(), id);
  }

  /**
   * Fabricates the result of the "inutilización de numeración" submit for a rejected invoice — same
   * rationale as {@link #fabricateCancellationResult(long, boolean)} (e2e's SIFEN endpoint is
   * unreachable, so a real submit never resolves APPROVED). {@code approved=true} mirrors {@code
   * SifenNumberVoidingService.recordSubmissionResult} + its auto-void step: the event goes {@code
   * APPROVED} and the invoice is voided.
   */
  @PostMapping("/invoices/{id}/fabricate-number-voiding-result/{approved}")
  @Transactional
  public void fabricateNumberVoidingResult(@PathVariable long id, @PathVariable boolean approved) {
    log.info(
        "POST /api/admin/sifen-test-support/invoices/{}/fabricate-number-voiding-result/{}",
        id,
        approved);
    Invoice invoice =
        invoiceRepository
            .findById(id)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "INVOICE_NOT_FOUND"));
    numberVoidingService.recordPendingForRejectedInvoice(invoice.getTenant().getId(), id);
    SifenNumberVoidingEvent event =
        numberVoidingEventRepository
            .findByInvoiceId(id)
            .orElseThrow(
                () ->
                    new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "SIFEN_NUMBER_VOIDING_NOT_FOUND"));
    event.setSubmittedAt(LocalDateTime.now(timeProperties.zoneId()));
    event.setReason("E2E inutilización");
    if (approved) {
      event.setResultCode("0600");
      event.setMessage("Evento registrado correctamente");
      event.setProtocolNumber("135791113");
      event.setStatus(SifenNumberVoidingStatus.APPROVED);
      if (invoice.getStatus() == InvoiceStatus.ISSUED) {
        invoice.setStatus(InvoiceStatus.VOIDED);
        invoice.setVoidReason("Numeración inutilizada ante SIFEN (protocolo 135791113)");
      }
    } else {
      event.setResultCode("4004");
      event.setMessage("Rango de numeración inconsistente");
      event.setStatus(SifenNumberVoidingStatus.REJECTED);
    }
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
    profile.setSifenDepartmentCode("12");
    profile.setSifenDepartmentName("CENTRAL");
    profile.setSifenCityCode("5044");
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
