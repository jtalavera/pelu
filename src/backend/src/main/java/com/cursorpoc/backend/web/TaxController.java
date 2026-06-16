package com.cursorpoc.backend.web;

import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.TaxService;
import com.cursorpoc.backend.web.dto.TaxResponse;
import com.cursorpoc.backend.web.dto.TaxUpsertRequest;
import jakarta.validation.Valid;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/taxes")
public class TaxController {

  private static final Logger log = LoggerFactory.getLogger(TaxController.class);

  private final TaxService taxService;

  public TaxController(TaxService taxService) {
    this.taxService = taxService;
  }

  @GetMapping
  public List<TaxResponse> list(@AuthenticationPrincipal FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    log.info("GET /api/taxes tenantId={}", principal.getTenantId());
    List<TaxResponse> result = taxService.listTaxes(principal.getTenantId());
    log.info(
        "GET /api/taxes tenantId={} status=200 count={}", principal.getTenantId(), result.size());
    return result;
  }

  @PostMapping
  public TaxResponse create(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @Valid @RequestBody TaxUpsertRequest request) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    log.info("POST /api/taxes tenantId={}", principal.getTenantId());
    try {
      TaxResponse response = taxService.createTax(principal.getTenantId(), request);
      log.info(
          "POST /api/taxes tenantId={} status=200 taxId={}",
          principal.getTenantId(),
          response.id());
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "POST /api/taxes tenantId={} status={}",
          principal.getTenantId(),
          ex.getStatusCode().value());
      throw ex;
    }
  }

  @PutMapping("/{id}")
  public TaxResponse update(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("id") long id,
      @Valid @RequestBody TaxUpsertRequest request) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    log.info("PUT /api/taxes/{} tenantId={}", id, principal.getTenantId());
    try {
      TaxResponse response = taxService.updateTax(principal.getTenantId(), id, request);
      log.info("PUT /api/taxes/{} tenantId={} status=200", id, principal.getTenantId());
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "PUT /api/taxes/{} tenantId={} status={}",
          id,
          principal.getTenantId(),
          ex.getStatusCode().value());
      throw ex;
    }
  }

  @PostMapping("/{id}/deactivate")
  public TaxResponse deactivate(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable("id") long id) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    log.info("POST /api/taxes/{}/deactivate tenantId={}", id, principal.getTenantId());
    try {
      TaxResponse response = taxService.deactivateTax(principal.getTenantId(), id);
      log.info("POST /api/taxes/{}/deactivate tenantId={} status=200", id, principal.getTenantId());
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "POST /api/taxes/{}/deactivate tenantId={} status={}",
          id,
          principal.getTenantId(),
          ex.getStatusCode().value());
      throw ex;
    }
  }

  @PostMapping("/{id}/activate")
  public TaxResponse activate(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable("id") long id) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    log.info("POST /api/taxes/{}/activate tenantId={}", id, principal.getTenantId());
    try {
      TaxResponse response = taxService.activateTax(principal.getTenantId(), id);
      log.info("POST /api/taxes/{}/activate tenantId={} status=200", id, principal.getTenantId());
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "POST /api/taxes/{}/activate tenantId={} status={}",
          id,
          principal.getTenantId(),
          ex.getStatusCode().value());
      throw ex;
    }
  }
}
