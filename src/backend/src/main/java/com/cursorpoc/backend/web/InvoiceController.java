package com.cursorpoc.backend.web;

import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.InvoiceService;
import com.cursorpoc.backend.web.dto.InvoiceCreateRequest;
import com.cursorpoc.backend.web.dto.InvoiceListItemResponse;
import com.cursorpoc.backend.web.dto.InvoiceResponse;
import com.cursorpoc.backend.web.dto.InvoiceVoidRequest;
import jakarta.validation.Valid;
import java.time.Instant;
import java.util.List;
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

  private final InvoiceService invoiceService;

  public InvoiceController(InvoiceService invoiceService) {
    this.invoiceService = invoiceService;
  }

  @PostMapping
  public ResponseEntity<InvoiceResponse> issue(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @Valid @RequestBody InvoiceCreateRequest request) {
    requirePrincipal(principal);
    log.info("POST /api/invoices tenantId={}", principal.getTenantId());
    InvoiceResponse response = invoiceService.issueInvoice(principal.getTenantId(), request);
    log.info("POST /api/invoices tenantId={} status=201", principal.getTenantId());
    return ResponseEntity.status(HttpStatus.CREATED).body(response);
  }

  @GetMapping
  public ResponseEntity<List<InvoiceListItemResponse>> list(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @RequestParam(required = false) String from,
      @RequestParam(required = false) String to,
      @RequestParam(required = false) Long clientId,
      @RequestParam(required = false) String status) {
    requirePrincipal(principal);
    log.info("GET /api/invoices tenantId={}", principal.getTenantId());
    Instant fromInstant = from != null ? Instant.parse(from) : null;
    Instant toInstant = to != null ? Instant.parse(to) : null;
    List<InvoiceListItemResponse> response =
        invoiceService.listInvoices(
            principal.getTenantId(), fromInstant, toInstant, clientId, status);
    log.info("GET /api/invoices tenantId={} status=200", principal.getTenantId());
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

  private static void requirePrincipal(FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
  }
}
