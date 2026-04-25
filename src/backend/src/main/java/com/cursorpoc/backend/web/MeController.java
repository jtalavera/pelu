package com.cursorpoc.backend.web;

import com.cursorpoc.backend.config.FemmeSystemAdminProperties;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.web.dto.MeResponse;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api")
public class MeController {

  private final FemmeSystemAdminProperties systemAdminProperties;

  public MeController(FemmeSystemAdminProperties systemAdminProperties) {
    this.systemAdminProperties = systemAdminProperties;
  }

  @GetMapping("/me")
  public MeResponse me(@AuthenticationPrincipal FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    Long preview =
        principal.getRole() == UserRole.SYSTEM_ADMIN ? systemAdminProperties.getTenantId() : null;
    return new MeResponse(
        principal.getUserId(),
        principal.getTenantId(),
        principal.getUsername(),
        principal.getRole().name(),
        principal.getProfessionalId(),
        preview);
  }
}
