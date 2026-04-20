package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.AppointmentService;
import com.cursorpoc.backend.web.dto.AppointmentCreateRequest;
import com.cursorpoc.backend.web.dto.AppointmentResponse;
import com.cursorpoc.backend.web.dto.AppointmentStatusUpdateRequest;
import com.cursorpoc.backend.web.dto.AppointmentUpdateRequest;
import jakarta.validation.Valid;
import java.time.Instant;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/appointments")
public class AppointmentController {

  private final AppointmentService appointmentService;

  public AppointmentController(AppointmentService appointmentService) {
    this.appointmentService = appointmentService;
  }

  @GetMapping
  public List<AppointmentResponse> list(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @RequestParam String from,
      @RequestParam String to,
      @RequestParam(required = false) Long professionalId) {
    requirePrincipal(principal);
    Instant fromInstant = parseInstantParam(from, "from");
    Instant toInstant = parseInstantParam(to, "to");
    Long effectiveProfessionalId = professionalId;
    if (principal.getRole() == UserRole.PROFESSIONAL) {
      effectiveProfessionalId = principal.getProfessionalId();
    }
    return appointmentService.list(
        principal.getTenantId(), fromInstant, toInstant, effectiveProfessionalId);
  }

  @GetMapping("/{id}")
  public AppointmentResponse get(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable("id") long id) {
    requirePrincipal(principal);
    return appointmentService.get(principal.getTenantId(), id);
  }

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  public AppointmentResponse create(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @Valid @RequestBody AppointmentCreateRequest request) {
    requirePrincipal(principal);
    if (principal.getRole() == UserRole.PROFESSIONAL) {
      Long ownId = principal.getProfessionalId();
      if (ownId == null || !ownId.equals(request.professionalId())) {
        throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
      }
    }
    return appointmentService.create(principal.getTenantId(), request);
  }

  @PatchMapping("/{id}/status")
  public AppointmentResponse updateStatus(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("id") long id,
      @Valid @RequestBody AppointmentStatusUpdateRequest request) {
    requirePrincipal(principal);
    return appointmentService.updateStatus(principal.getTenantId(), id, request);
  }

  @PutMapping("/{id}")
  public AppointmentResponse update(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("id") long id,
      @Valid @RequestBody AppointmentUpdateRequest request) {
    requirePrincipal(principal);
    if (principal.getRole() == UserRole.PROFESSIONAL) {
      Long ownId = principal.getProfessionalId();
      if (ownId == null || !ownId.equals(request.professionalId())) {
        throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
      }
    }
    return appointmentService.update(principal.getTenantId(), id, request);
  }

  private static void requirePrincipal(FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
  }

  private static Instant parseInstantParam(String value, String paramName) {
    try {
      return Instant.parse(value);
    } catch (Exception e) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "INVALID_DATE_FORMAT_" + paramName.toUpperCase());
    }
  }
}
