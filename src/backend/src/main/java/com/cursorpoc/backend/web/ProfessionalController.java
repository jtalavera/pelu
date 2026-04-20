package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.AuthService;
import com.cursorpoc.backend.service.ProfessionalDirectoryService;
import com.cursorpoc.backend.web.dto.GrantAccessResponse;
import com.cursorpoc.backend.web.dto.ProfessionalResponse;
import com.cursorpoc.backend.web.dto.ProfessionalScheduleRequest;
import com.cursorpoc.backend.web.dto.ProfessionalUpsertRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.Locale;
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
@RequestMapping("/api/professionals")
public class ProfessionalController {

  private final ProfessionalDirectoryService professionalDirectoryService;
  private final AuthService authService;

  public ProfessionalController(
      ProfessionalDirectoryService professionalDirectoryService, AuthService authService) {
    this.professionalDirectoryService = professionalDirectoryService;
    this.authService = authService;
  }

  @GetMapping
  public List<ProfessionalResponse> list(@AuthenticationPrincipal FemmeUserPrincipal principal) {
    requirePrincipal(principal);
    return professionalDirectoryService.list(principal.getTenantId());
  }

  @PostMapping
  public ProfessionalResponse create(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @Valid @RequestBody ProfessionalUpsertRequest request) {
    requireAdmin(principal);
    return professionalDirectoryService.create(principal.getTenantId(), request);
  }

  @PutMapping("/{id}")
  public ProfessionalResponse update(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("id") long id,
      @Valid @RequestBody ProfessionalUpsertRequest request) {
    requireAdmin(principal);
    return professionalDirectoryService.update(principal.getTenantId(), id, request);
  }

  @PostMapping("/{id}/deactivate")
  public ProfessionalResponse deactivate(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable("id") long id) {
    requireAdmin(principal);
    return professionalDirectoryService.deactivate(principal.getTenantId(), id);
  }

  @PostMapping("/{id}/activate")
  public ProfessionalResponse activate(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable("id") long id) {
    requireAdmin(principal);
    return professionalDirectoryService.activate(principal.getTenantId(), id);
  }

  @PutMapping("/{id}/schedules")
  public ProfessionalResponse updateSchedules(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("id") long id,
      @Valid @RequestBody @NotNull List<ProfessionalScheduleRequest> schedules) {
    requireAdmin(principal);
    return professionalDirectoryService.updateSchedules(principal.getTenantId(), id, schedules);
  }

  @PostMapping("/{id}/grant-access")
  public GrantAccessResponse grantAccess(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("id") long id,
      Locale locale) {
    requireAdmin(principal);
    return authService.grantProfessionalAccess(principal.getTenantId(), id, locale);
  }

  @PostMapping("/{id}/revoke-access")
  public void revokeAccess(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable("id") long id) {
    requireAdmin(principal);
    authService.revokeProfessionalAccess(principal.getTenantId(), id);
  }

  private static void requirePrincipal(FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
  }

  private static void requireAdmin(FemmeUserPrincipal principal) {
    requirePrincipal(principal);
    if (principal.getRole() != UserRole.ADMIN) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
  }
}
