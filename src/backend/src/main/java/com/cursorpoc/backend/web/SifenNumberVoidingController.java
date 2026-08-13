package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.SifenNumberVoidingService;
import com.cursorpoc.backend.web.dto.SifenNumberVoidingEventResponse;
import com.cursorpoc.backend.web.dto.SifenNumberVoidingSubmitRequest;
import jakarta.validation.Valid;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** RT-25 (Hardening_SIFEN.md). */
@RestController
@RequestMapping("/api/sifen/number-voiding")
public class SifenNumberVoidingController {

  private static final Logger log = LoggerFactory.getLogger(SifenNumberVoidingController.class);

  private final SifenNumberVoidingService service;

  public SifenNumberVoidingController(SifenNumberVoidingService service) {
    this.service = service;
  }

  @GetMapping
  public List<SifenNumberVoidingEventResponse> list(
      @AuthenticationPrincipal FemmeUserPrincipal principal) {
    requirePrincipal(principal);
    long tenantId = principal.getTenantId();
    log.info("GET /api/sifen/number-voiding method=GET tenantId={}", tenantId);
    List<SifenNumberVoidingEventResponse> out = service.listForTenant(tenantId);
    log.info("GET /api/sifen/number-voiding tenantId={} status=200", tenantId);
    return out;
  }

  @PostMapping("/{id}/submit")
  public SifenNumberVoidingEventResponse submit(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable long id,
      @Valid @RequestBody SifenNumberVoidingSubmitRequest request) {
    requireTenantAdmin(principal);
    long tenantId = principal.getTenantId();
    log.info("POST /api/sifen/number-voiding/{}/submit method=POST tenantId={}", id, tenantId);
    try {
      SifenNumberVoidingEventResponse out = service.submit(tenantId, id, request.reason());
      log.info("POST /api/sifen/number-voiding/{}/submit tenantId={} status=200", id, tenantId);
      return out;
    } catch (ResponseStatusException ex) {
      log.error(
          "POST /api/sifen/number-voiding/{}/submit tenantId={} status={}",
          id,
          tenantId,
          ex.getStatusCode());
      throw ex;
    }
  }

  private static void requirePrincipal(FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
  }

  private static void requireTenantAdmin(FemmeUserPrincipal principal) {
    requirePrincipal(principal);
    if (principal.getRole() != UserRole.ADMIN) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
  }
}
