package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.SifenCscService;
import com.cursorpoc.backend.web.dto.SifenCscResponse;
import com.cursorpoc.backend.web.dto.SifenCscSaveRequest;
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

/**
 * Configuración → SIFEN → CSC. Each tenant loads the Código de Seguridad del Contribuyente the DNIT
 * issued to it; the QR of its invoices is hashed with that one. Tenant-admin only. The CSC value is
 * write-only: {@link SifenCscResponse} never carries it and it is never logged.
 */
@RestController
@RequestMapping("/api/sifen/csc")
public class SifenCscController {

  private static final Logger log = LoggerFactory.getLogger(SifenCscController.class);

  private final SifenCscService cscService;

  public SifenCscController(SifenCscService cscService) {
    this.cscService = cscService;
  }

  @GetMapping
  public List<SifenCscResponse> list(@AuthenticationPrincipal FemmeUserPrincipal principal) {
    requireTenantAdmin(principal);
    long tenantId = principal.getTenantId();
    log.info("GET /api/sifen/csc method=GET tenantId={}", tenantId);
    List<SifenCscResponse> out = cscService.list(tenantId);
    log.info("GET /api/sifen/csc tenantId={} status=200", tenantId);
    return out;
  }

  @PostMapping
  public SifenCscResponse save(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @Valid @RequestBody SifenCscSaveRequest request) {
    requireTenantAdmin(principal);
    long tenantId = principal.getTenantId();
    log.info("POST /api/sifen/csc method=POST tenantId={} idCsc={}", tenantId, request.idCsc());
    try {
      SifenCscResponse out = cscService.save(tenantId, principal.getUserId(), request);
      log.info("POST /api/sifen/csc tenantId={} status=200", tenantId);
      return out;
    } catch (ResponseStatusException e) {
      log.error("POST /api/sifen/csc tenantId={} status={}", tenantId, e.getStatusCode().value());
      throw e;
    }
  }

  @PostMapping("/{idCsc}/activate")
  public SifenCscResponse activate(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable int idCsc) {
    requireTenantAdmin(principal);
    long tenantId = principal.getTenantId();
    log.info("POST /api/sifen/csc/{}/activate method=POST tenantId={}", idCsc, tenantId);
    try {
      SifenCscResponse out = cscService.activate(tenantId, principal.getUserId(), idCsc);
      log.info("POST /api/sifen/csc/{}/activate tenantId={} status=200", idCsc, tenantId);
      return out;
    } catch (ResponseStatusException e) {
      log.error(
          "POST /api/sifen/csc/{}/activate tenantId={} status={}",
          idCsc,
          tenantId,
          e.getStatusCode().value());
      throw e;
    }
  }

  private static void requireTenantAdmin(FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    if (principal.getRole() != UserRole.ADMIN) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
  }
}
