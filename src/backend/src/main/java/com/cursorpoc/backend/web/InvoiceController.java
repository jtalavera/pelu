package com.cursorpoc.backend.web;

import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.FeatureFlagService;
import com.cursorpoc.backend.service.InvoiceService;
import com.cursorpoc.backend.service.SifenCertificateService;
import com.cursorpoc.backend.service.SifenInvoiceCancellationService;
import com.cursorpoc.backend.service.SifenInvoiceClientIdentificationService;
import com.cursorpoc.backend.service.SifenInvoiceSubmissionService;
import com.cursorpoc.backend.service.SifenSubmissionQueue;
import com.cursorpoc.backend.web.dto.InvoiceCancellationRequest;
import com.cursorpoc.backend.web.dto.InvoiceClientIdentificationRequest;
import com.cursorpoc.backend.web.dto.InvoiceCreateRequest;
import com.cursorpoc.backend.web.dto.InvoiceResponse;
import com.cursorpoc.backend.web.dto.InvoiceVoidRequest;
import com.cursorpoc.backend.web.dto.PagedInvoicesResponse;
import jakarta.validation.Valid;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/invoices")
public class InvoiceController {

  private static final Logger log = LoggerFactory.getLogger(InvoiceController.class);

  /**
   * SIFEN HU-22 (Fase 5): the real per-tenant switch between the SIFEN pipeline and the traditional
   * generator, wired here since {@code issue()} is the single entry point for both (see
   * PROGRESS.md).
   */
  static final String SIFEN_ELECTRONIC_INVOICING_FLAG_KEY = "SIFEN_ELECTRONIC_INVOICING";

  private final InvoiceService invoiceService;
  private final SifenInvoiceSubmissionService sifenInvoiceSubmissionService;
  private final SifenInvoiceCancellationService sifenInvoiceCancellationService;
  private final SifenInvoiceClientIdentificationService sifenInvoiceClientIdentificationService;
  private final FeatureFlagService featureFlagService;
  private final SifenCertificateService sifenCertificateService;
  private final SifenSubmissionQueue sifenSubmissionQueue;

  public InvoiceController(
      InvoiceService invoiceService,
      SifenInvoiceSubmissionService sifenInvoiceSubmissionService,
      SifenInvoiceCancellationService sifenInvoiceCancellationService,
      SifenInvoiceClientIdentificationService sifenInvoiceClientIdentificationService,
      FeatureFlagService featureFlagService,
      SifenCertificateService sifenCertificateService,
      SifenSubmissionQueue sifenSubmissionQueue) {
    this.invoiceService = invoiceService;
    this.sifenInvoiceSubmissionService = sifenInvoiceSubmissionService;
    this.sifenInvoiceCancellationService = sifenInvoiceCancellationService;
    this.sifenInvoiceClientIdentificationService = sifenInvoiceClientIdentificationService;
    this.featureFlagService = featureFlagService;
    this.sifenCertificateService = sifenCertificateService;
    this.sifenSubmissionQueue = sifenSubmissionQueue;
  }

  /**
   * SIFEN HU-22 AC-03/AC-04: routes between the traditional generator and the SIFEN pipeline based
   * on the tenant's {@value #SIFEN_ELECTRONIC_INVOICING_FLAG_KEY} flag. When enabled, a valid
   * certificate is required *before* the invoice is created (AC-04: blocks issuance entirely,
   * nothing is persisted, if {@link SifenCertificateService#requireActiveCertificate} throws).
   *
   * <p>RT-20 (Hardening_SIFEN.md): the freshly persisted invoice is signed synchronously — {@link
   * SifenInvoiceSubmissionService#prepareAndSign} mints the CDC/QR and marks it {@code QUEUED},
   * with zero calls to SIFEN — and a transmit attempt is enqueued for the async consumer to pick
   * up. This request never waits on SIFEN itself; the response already carries the CDC/QR, which is
   * what makes the KuDE (RT-28) downloadable the instant this returns, before SIFEN has answered.
   * When the flag is disabled, the invoice is issued exactly as before this story — the traditional
   * generator is simply "no SIFEN fields ever get populated" (AC-03), not a separate code path.
   */
  @PostMapping
  public ResponseEntity<InvoiceResponse> issue(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @Valid @RequestBody InvoiceCreateRequest request) {
    requirePrincipal(principal);
    long tenantId = principal.getTenantId();
    log.info("POST /api/invoices tenantId={}", tenantId);
    boolean sifenEnabled =
        featureFlagService.isEnabled(SIFEN_ELECTRONIC_INVOICING_FLAG_KEY, tenantId);
    if (sifenEnabled) {
      sifenCertificateService.requireActiveCertificate(tenantId);
    }
    InvoiceResponse response = invoiceService.issueInvoice(tenantId, request);
    if (sifenEnabled) {
      sifenInvoiceSubmissionService.prepareAndSign(tenantId, response.id());
      String correlationId = UUID.randomUUID().toString();
      sifenSubmissionQueue.enqueue(tenantId, response.id(), 1, Duration.ZERO, correlationId);
      response = invoiceService.getInvoice(tenantId, response.id());
    }
    log.info("POST /api/invoices tenantId={} status=201", tenantId);
    return ResponseEntity.status(HttpStatus.CREATED).body(response);
  }

  @GetMapping
  public ResponseEntity<PagedInvoicesResponse> list(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @RequestParam(required = false) String from,
      @RequestParam(required = false) String to,
      @RequestParam(required = false) Long clientId,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) String q,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "10") int size) {
    requirePrincipal(principal);
    log.info("GET /api/invoices tenantId={} page={} size={}", principal.getTenantId(), page, size);
    Instant fromInstant = from != null ? Instant.parse(from) : null;
    Instant toInstant = to != null ? Instant.parse(to) : null;
    PagedInvoicesResponse response =
        invoiceService.listInvoices(
            principal.getTenantId(), fromInstant, toInstant, clientId, status, q, page, size);
    log.info(
        "GET /api/invoices tenantId={} status=200 total={}",
        principal.getTenantId(),
        response.totalElements());
    return ResponseEntity.ok(response);
  }

  @GetMapping("/{id}")
  public ResponseEntity<InvoiceResponse> get(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable Long id) {
    requirePrincipal(principal);
    log.info("GET /api/invoices/{} tenantId={}", id, principal.getTenantId());
    InvoiceResponse response = invoiceService.getInvoice(principal.getTenantId(), id);
    log.info("GET /api/invoices/{} tenantId={} status=200", id, principal.getTenantId());
    return ResponseEntity.ok(response);
  }

  @PostMapping("/{id}/void")
  public ResponseEntity<InvoiceResponse> voidInvoice(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable Long id,
      @Valid @RequestBody InvoiceVoidRequest request) {
    requirePrincipal(principal);
    log.info("POST /api/invoices/{}/void tenantId={}", id, principal.getTenantId());
    InvoiceResponse response = invoiceService.voidInvoice(principal.getTenantId(), id, request);
    log.info("POST /api/invoices/{}/void tenantId={} status=200", id, principal.getTenantId());
    return ResponseEntity.ok(response);
  }

  /**
   * SIFEN HU-07 AC-04: manually triggers a status query to SIFEN for an invoice this system marked
   * 'pendiente de verificación'. Returns the invoice's fresh state either way — if SIFEN still
   * gives no answer, the invoice stays PENDING_VERIFICATION and the response reflects that.
   */
  @PostMapping("/{id}/sifen/check-status")
  public ResponseEntity<InvoiceResponse> checkSifenStatus(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable Long id) {
    requirePrincipal(principal);
    log.info("POST /api/invoices/{}/sifen/check-status tenantId={}", id, principal.getTenantId());
    sifenInvoiceSubmissionService.checkPendingStatus(principal.getTenantId(), id);
    InvoiceResponse response = invoiceService.getInvoice(principal.getTenantId(), id);
    log.info(
        "POST /api/invoices/{}/sifen/check-status tenantId={} status=200",
        id,
        principal.getTenantId());
    return ResponseEntity.ok(response);
  }

  /**
   * SIFEN HU-10: registers a cancellation event with SIFEN for an invoice currently Aprobado/
   * Aprobado con observación (AC-01), within the 48h window since its approval (AC-02). Returns the
   * invoice's fresh state either way — SIFEN approving moves it to Cancelada (AC-03); SIFEN
   * rejecting leaves it exactly as it was, with the rejection reason recorded (AC-04). AC-05: who
   * requested it and when is recorded regardless of the outcome.
   */
  @PostMapping("/{id}/sifen/cancel")
  public ResponseEntity<InvoiceResponse> cancelSifenInvoice(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable Long id,
      @Valid @RequestBody InvoiceCancellationRequest request) {
    requirePrincipal(principal);
    log.info("POST /api/invoices/{}/sifen/cancel tenantId={}", id, principal.getTenantId());
    sifenInvoiceCancellationService.cancel(
        principal.getTenantId(),
        id,
        principal.getUserId(),
        principal.getUsername(),
        request.reason());
    InvoiceResponse response = invoiceService.getInvoice(principal.getTenantId(), id);
    log.info(
        "POST /api/invoices/{}/sifen/cancel tenantId={} status=200", id, principal.getTenantId());
    return ResponseEntity.ok(response);
  }

  /**
   * SIFEN HU-11: registers a client-identification event with SIFEN for an invoice currently
   * Aprobado/Aprobado con observación that was issued without client data and hasn't been
   * identified before (AC-01). Returns the invoice's fresh state either way — SIFEN approving marks
   * it identified and updates its client fields (AC-05); SIFEN rejecting leaves it exactly as it
   * was, with the rejection reason recorded (AC-06).
   */
  @PostMapping("/{id}/sifen/identify-client")
  public ResponseEntity<InvoiceResponse> identifySifenClient(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable Long id,
      @Valid @RequestBody InvoiceClientIdentificationRequest request) {
    requirePrincipal(principal);
    log.info(
        "POST /api/invoices/{}/sifen/identify-client tenantId={}", id, principal.getTenantId());
    sifenInvoiceClientIdentificationService.identifyClient(
        principal.getTenantId(), id, principal.getUserId(), principal.getUsername(), request);
    InvoiceResponse response = invoiceService.getInvoice(principal.getTenantId(), id);
    log.info(
        "POST /api/invoices/{}/sifen/identify-client tenantId={} status=200",
        id,
        principal.getTenantId());
    return ResponseEntity.ok(response);
  }

  private static void requirePrincipal(FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
  }
}
