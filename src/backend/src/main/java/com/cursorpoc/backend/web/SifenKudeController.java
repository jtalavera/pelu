package com.cursorpoc.backend.web;

import com.cursorpoc.backend.config.SifenConnectionProperties;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.SifenKudeEmailService;
import com.cursorpoc.backend.service.SifenKudePdfService;
import com.cursorpoc.backend.web.dto.SifenKudeEmailRequest;
import java.util.Locale;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
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

/**
 * SIFEN HU-08: the KuDE (PDF representation of an approved invoice) — AC-16 (download) and AC-17
 * (email to the client). Own controller, same pattern as {@code SifenCertificateController}: a
 * SIFEN-specific concern gets its own file rather than growing {@code InvoiceController}/{@code
 * InvoicePdfController} (the traditional, non-SIFEN invoice PDF HU-08 must never be confused with).
 */
@RestController
@RequestMapping("/api/invoices")
public class SifenKudeController {

  private static final Logger log = LoggerFactory.getLogger(SifenKudeController.class);

  /**
   * The KuDE's dates/money are always rendered in the fixed business locale, like its PDF layout.
   */
  private static final Locale KUDE_LOCALE = Locale.forLanguageTag("es-PY");

  private final SifenKudePdfService pdfService;
  private final SifenKudeEmailService emailService;
  private final SifenConnectionProperties connectionProperties;

  public SifenKudeController(
      SifenKudePdfService pdfService,
      SifenKudeEmailService emailService,
      SifenConnectionProperties connectionProperties) {
    this.pdfService = pdfService;
    this.emailService = emailService;
    this.connectionProperties = connectionProperties;
  }

  /**
   * AC-16: downloadable from the invoice detail screen.
   *
   * <p>{@code ?sample=true} renders a "production-style" preview instead — same KuDE, but with the
   * issuer's real razón social in place of the test-environment legend, and a {@code MUESTRA-}
   * filename prefix (see {@link SifenKudePdfService#buildProductionSampleKudePdf}). Only meaningful
   * while the SIFEN connection runs against the test environment; in production the sample would be
   * byte-identical to the real KuDE, so it is rejected with {@code SIFEN_KUDE_SAMPLE_ONLY_IN_TEST}.
   */
  @GetMapping(value = "/{id}/sifen/kude", produces = MediaType.APPLICATION_PDF_VALUE)
  public ResponseEntity<byte[]> download(
      @PathVariable long id,
      @RequestParam(name = "sample", defaultValue = "false") boolean sample,
      @AuthenticationPrincipal FemmeUserPrincipal principal) {
    requireAuthenticated(principal);
    log.info(
        "GET /api/invoices/{}/sifen/kude tenantId={} sample={}",
        id,
        principal.getTenantId(),
        sample);
    try {
      if (sample
          && connectionProperties.activeEnvironment()
              == SifenConnectionProperties.Environment.PRODUCTION) {
        throw new ResponseStatusException(HttpStatus.CONFLICT, "SIFEN_KUDE_SAMPLE_ONLY_IN_TEST");
      }
      SifenKudePdfService.KudePdfResult result =
          sample
              ? pdfService.buildProductionSampleKudePdf(principal.getTenantId(), id)
              : pdfService.buildKudePdf(principal.getTenantId(), id);
      log.info(
          "GET /api/invoices/{}/sifen/kude tenantId={} sample={} status=200",
          id,
          principal.getTenantId(),
          sample);
      return ResponseEntity.ok()
          .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"" + result.filename() + "\"")
          .body(result.bytes());
    } catch (ResponseStatusException ex) {
      log.error(
          "GET /api/invoices/{}/sifen/kude tenantId={} sample={} status={}",
          id,
          principal.getTenantId(),
          sample,
          ex.getStatusCode().value());
      throw ex;
    }
  }

  /** AC-17: sends the same KuDE by email, directly from the system. */
  @PostMapping("/{id}/sifen/kude/email")
  public ResponseEntity<Void> sendByEmail(
      @PathVariable long id,
      @RequestBody(required = false) SifenKudeEmailRequest request,
      @AuthenticationPrincipal FemmeUserPrincipal principal) {
    requireAuthenticated(principal);
    log.info("POST /api/invoices/{}/sifen/kude/email tenantId={}", id, principal.getTenantId());
    try {
      String requestedEmail = request != null ? request.email() : null;
      emailService.sendByEmail(principal.getTenantId(), id, requestedEmail, KUDE_LOCALE);
      log.info(
          "POST /api/invoices/{}/sifen/kude/email tenantId={} status=204",
          id,
          principal.getTenantId());
      return ResponseEntity.noContent().build();
    } catch (ResponseStatusException ex) {
      log.error(
          "POST /api/invoices/{}/sifen/kude/email tenantId={} status={}",
          id,
          principal.getTenantId(),
          ex.getStatusCode().value());
      throw ex;
    }
  }

  private static void requireAuthenticated(FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
  }
}
