package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.SifenCscService;
import com.cursorpoc.backend.web.dto.SifenCscResponse;
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
 * Configuración → SIFEN → CSC, read-only for the salon's administrator: which Código de Seguridad
 * del Contribuyente (IdCSC) the platform has loaded for the salon and which one is active. Loading
 * or activating a CSC is a root-user operation ({@link PlatformSifenController}). The CSC value
 * itself is write-only: {@link SifenCscResponse} never carries it and it is never logged.
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

  private static void requireTenantAdmin(FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    if (principal.getRole() != UserRole.ADMIN) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
  }
}
