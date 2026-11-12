package com.cursorpoc.backend.web;

import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.InvoiceLateTipService;
import com.cursorpoc.backend.web.dto.CreateLateTipsRequest;
import com.cursorpoc.backend.web.dto.InvoiceTipsResponse;
import jakarta.validation.Valid;
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
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Tips of an invoice, including the ones left after it was issued (HU-73). Whoever can issue
 * invoices can list and add them; voiding one is admin-only and lives in {@link TipsController}.
 */
@RestController
@RequestMapping("/api/invoices/{invoiceId}/tips")
public class InvoiceTipsController {

  private static final Logger log = LoggerFactory.getLogger(InvoiceTipsController.class);

  private final InvoiceLateTipService invoiceLateTipService;

  public InvoiceTipsController(InvoiceLateTipService invoiceLateTipService) {
    this.invoiceLateTipService = invoiceLateTipService;
  }

  @GetMapping
  public InvoiceTipsResponse list(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable Long invoiceId) {
    requirePrincipal(principal);
    long tenantId = principal.getTenantId();
    log.info("GET /api/invoices/{}/tips tenantId={}", invoiceId, tenantId);
    try {
      InvoiceTipsResponse response = invoiceLateTipService.list(tenantId, invoiceId);
      log.info("GET /api/invoices/{}/tips tenantId={} status=200", invoiceId, tenantId);
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "GET /api/invoices/{}/tips tenantId={} status={}",
          invoiceId,
          tenantId,
          ex.getStatusCode().value());
      throw ex;
    }
  }

  @PostMapping
  public ResponseEntity<InvoiceTipsResponse> create(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable Long invoiceId,
      @Valid @RequestBody CreateLateTipsRequest request) {
    requirePrincipal(principal);
    long tenantId = principal.getTenantId();
    log.info("POST /api/invoices/{}/tips tenantId={}", invoiceId, tenantId);
    try {
      InvoiceTipsResponse response =
          invoiceLateTipService.create(tenantId, principal.getUserId(), invoiceId, request.tips());
      log.info("POST /api/invoices/{}/tips tenantId={} status=201", invoiceId, tenantId);
      return ResponseEntity.status(HttpStatus.CREATED).body(response);
    } catch (ResponseStatusException ex) {
      log.error(
          "POST /api/invoices/{}/tips tenantId={} status={}",
          invoiceId,
          tenantId,
          ex.getStatusCode().value());
      throw ex;
    }
  }

  private static void requirePrincipal(FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
  }
}
