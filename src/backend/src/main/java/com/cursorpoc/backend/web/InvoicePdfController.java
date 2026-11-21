package com.cursorpoc.backend.web;

import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.NonFiscalReceiptEmailService;
import com.cursorpoc.backend.service.NonFiscalReceiptPdfService;
import com.cursorpoc.backend.web.dto.InvoiceReceiptEmailRequest;
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
 * The printable comprobante of an issued invoice when SIFEN electronic invoicing is not active: the
 * NON-fiscal receipt, in A4 or as an 80 mm ticket ({@code ?format=A4|TICKET}, A4 by default).
 */
@RestController
@RequestMapping("/api/invoices")
public class InvoicePdfController {

  private static final Logger log = LoggerFactory.getLogger(InvoicePdfController.class);

  private final NonFiscalReceiptPdfService receiptPdfService;
  private final NonFiscalReceiptEmailService receiptEmailService;

  public InvoicePdfController(
      NonFiscalReceiptPdfService receiptPdfService,
      NonFiscalReceiptEmailService receiptEmailService) {
    this.receiptPdfService = receiptPdfService;
    this.receiptEmailService = receiptEmailService;
  }

  /**
   * «Compartir con el cliente» for a non-fiscal receipt: e-mails the PDF. With a blank {@code
   * email} it goes to the one on the invoice or the client's own (400 {@code
   * RECEIPT_EMAIL_REQUIRED} if there is none).
   */
  @PostMapping("/{id}/pdf/email")
  public ResponseEntity<Void> emailPdf(
      @PathVariable Long id,
      @RequestBody(required = false) InvoiceReceiptEmailRequest request,
      @AuthenticationPrincipal FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    log.info("POST /api/invoices/{}/pdf/email tenantId={}", id, principal.getTenantId());
    try {
      receiptEmailService.sendByEmail(
          principal.getTenantId(),
          id,
          request == null ? null : request.email(),
          request == null ? null : request.format(),
          Locale.forLanguageTag("es-PY"));
      log.info(
          "POST /api/invoices/{}/pdf/email tenantId={} status=204", id, principal.getTenantId());
      return ResponseEntity.noContent().build();
    } catch (ResponseStatusException ex) {
      log.error(
          "POST /api/invoices/{}/pdf/email tenantId={} status={}",
          id,
          principal.getTenantId(),
          ex.getStatusCode().value());
      throw ex;
    }
  }

  @GetMapping(value = "/{id}/pdf", produces = MediaType.APPLICATION_PDF_VALUE)
  public ResponseEntity<byte[]> pdf(
      @PathVariable Long id,
      @RequestParam(name = "format", required = false) String format,
      @AuthenticationPrincipal FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    log.info("GET /api/invoices/{}/pdf tenantId={} format={}", id, principal.getTenantId(), format);
    try {
      NonFiscalReceiptPdfService.ReceiptResult result =
          receiptPdfService.buildReceipt(
              id, principal.getTenantId(), NonFiscalReceiptPdfService.Format.parse(format));
      log.info("GET /api/invoices/{}/pdf tenantId={} status=200", id, principal.getTenantId());
      return ResponseEntity.ok()
          .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"" + result.filename() + "\"")
          .body(result.bytes());
    } catch (ResponseStatusException ex) {
      log.error(
          "GET /api/invoices/{}/pdf tenantId={} status={}",
          id,
          principal.getTenantId(),
          ex.getStatusCode().value());
      throw ex;
    }
  }
}
