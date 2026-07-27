package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.SifenCertificateService;
import com.cursorpoc.backend.web.dto.SifenCertificateResponse;
import com.cursorpoc.backend.web.dto.SifenCertificateUploadRequest;
import jakarta.validation.Valid;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** HU-18: upload and list SIFEN digital certificates. Tenant-admin only (Configuración → SIFEN). */
@RestController
@RequestMapping("/api/sifen/certificates")
public class SifenCertificateController {

  private static final Logger log = LoggerFactory.getLogger(SifenCertificateController.class);

  private final SifenCertificateService sifenCertificateService;

  public SifenCertificateController(SifenCertificateService sifenCertificateService) {
    this.sifenCertificateService = sifenCertificateService;
  }

  @GetMapping
  public List<SifenCertificateResponse> list(
      @AuthenticationPrincipal FemmeUserPrincipal principal) {
    requireTenantAdmin(principal);
    long tenantId = principal.getTenantId();
    log.info("GET /api/sifen/certificates method=GET tenantId={}", tenantId);
    List<SifenCertificateResponse> out = sifenCertificateService.list(tenantId);
    log.info("GET /api/sifen/certificates tenantId={} status=200", tenantId);
    return out;
  }

  @PostMapping
  public SifenCertificateResponse upload(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @Valid @RequestBody SifenCertificateUploadRequest request) {
    requireTenantAdmin(principal);
    long tenantId = principal.getTenantId();
    log.info("POST /api/sifen/certificates method=POST tenantId={}", tenantId);
    try {
      SifenCertificateResponse out =
          sifenCertificateService.upload(tenantId, principal.getUserId(), request);
      log.info("POST /api/sifen/certificates tenantId={} status=200", tenantId);
      return out;
    } catch (ResponseStatusException e) {
      log.error("POST /api/sifen/certificates tenantId={} status={}", tenantId, e.getStatusCode());
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
