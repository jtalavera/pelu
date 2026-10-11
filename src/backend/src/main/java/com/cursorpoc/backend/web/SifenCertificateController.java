package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.SifenCertificateService;
import com.cursorpoc.backend.web.dto.SifenCertificateResponse;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-19: {@link #list} returns the tenant's full certificate history (upload/issue/expiry dates +
 * HU-20's live-computed status only — never the private key, .p12 bytes, or password, see {@link
 * SifenCertificateResponse}). Read-only for the salon's administrator (Configuración → SIFEN):
 * HU-18's upload is a root-user operation ({@link PlatformSifenController}), so there is
 * deliberately no write endpoint here.
 */
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

  private static void requireTenantAdmin(FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    if (principal.getRole() != UserRole.ADMIN) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
  }
}
