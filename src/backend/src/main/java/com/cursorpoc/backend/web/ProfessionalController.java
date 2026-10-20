package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.ProfessionalDirectoryService;
import com.cursorpoc.backend.web.dto.GrantAccessResponse;
import com.cursorpoc.backend.web.dto.PageResponse;
import com.cursorpoc.backend.web.dto.ProfessionalResponse;
import com.cursorpoc.backend.web.dto.ProfessionalScheduleRequest;
import com.cursorpoc.backend.web.dto.ProfessionalUpsertRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.Locale;
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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/professionals")
public class ProfessionalController {

  private static final Logger log = LoggerFactory.getLogger(ProfessionalController.class);

  private final ProfessionalDirectoryService professionalDirectoryService;

  public ProfessionalController(ProfessionalDirectoryService professionalDirectoryService) {
    this.professionalDirectoryService = professionalDirectoryService;
  }

  @GetMapping
  public List<ProfessionalResponse> list(@AuthenticationPrincipal FemmeUserPrincipal principal) {
    requirePrincipal(principal);
    // Issue #38 follow-up: professionals use this list for the calendar filter and the appointment
    // form, so they get names/photos/schedules only — no colleagues' contact or access data.
    if (principal.getRole() != UserRole.ADMIN) {
      return professionalDirectoryService.listDirectory(principal.getTenantId());
    }
    return professionalDirectoryService.list(principal.getTenantId());
  }

  @GetMapping("/page")
  public PageResponse<ProfessionalResponse> listPaged(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(name = "page", defaultValue = "0") int page,
      @RequestParam(name = "size", defaultValue = "10") int size) {
    requirePrincipal(principal);
    log.info(
        "GET /api/professionals/page tenantId={} page={} size={}",
        principal.getTenantId(),
        page,
        size);
    try {
      PageResponse<ProfessionalResponse> response =
          professionalDirectoryService.listPaged(principal.getTenantId(), q, page, size);
      log.info(
          "GET /api/professionals/page tenantId={} status=200 total={}",
          principal.getTenantId(),
          response.totalElements());
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "GET /api/professionals/page tenantId={} status={}",
          principal.getTenantId(),
          ex.getStatusCode().value());
      throw ex;
    }
  }

  @PostMapping
  public ProfessionalResponse create(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @Valid @RequestBody ProfessionalUpsertRequest request,
      Locale locale) {
    requireAdmin(principal);
    return professionalDirectoryService.create(principal.getTenantId(), request, locale);
  }

  @PutMapping("/{id}")
  public ProfessionalResponse update(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("id") long id,
      @Valid @RequestBody ProfessionalUpsertRequest request,
      Locale locale) {
    requireAdmin(principal);
    return professionalDirectoryService.update(principal.getTenantId(), id, request, locale);
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
    return professionalDirectoryService.grantAccess(principal.getTenantId(), id, locale);
  }

  /** Issue #38 (5): "Reenviar invitación" — pending invitations only, 2-minute cooldown. */
  @PostMapping("/{id}/resend-access")
  public ProfessionalResponse resendAccess(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("id") long id,
      Locale locale) {
    requireAdmin(principal);
    log.info("POST /api/professionals/{}/resend-access tenantId={}", id, principal.getTenantId());
    try {
      ProfessionalResponse response =
          professionalDirectoryService.resendAccess(principal.getTenantId(), id, locale);
      log.info(
          "POST /api/professionals/{}/resend-access tenantId={} status=200",
          id,
          principal.getTenantId());
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "POST /api/professionals/{}/resend-access tenantId={} status={}",
          id,
          principal.getTenantId(),
          ex.getStatusCode().value());
      throw ex;
    }
  }

  @PostMapping("/{id}/revoke-access")
  public void revokeAccess(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable("id") long id) {
    requireAdmin(principal);
    professionalDirectoryService.revokeAccess(principal.getTenantId(), id);
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
