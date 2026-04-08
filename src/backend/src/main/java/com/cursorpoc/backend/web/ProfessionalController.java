package com.cursorpoc.backend.web;

import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.ProfessionalDirectoryService;
import com.cursorpoc.backend.web.dto.ProfessionalResponse;
import com.cursorpoc.backend.web.dto.ProfessionalScheduleRequest;
import com.cursorpoc.backend.web.dto.ProfessionalUpsertRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.List;
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

  public ProfessionalController(ProfessionalDirectoryService professionalDirectoryService) {
    this.professionalDirectoryService = professionalDirectoryService;
  }

  @GetMapping
  public List<ProfessionalResponse> list(@AuthenticationPrincipal FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    return professionalDirectoryService.list(principal.getTenantId());
  }

  @PostMapping
  public ProfessionalResponse create(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @Valid @RequestBody ProfessionalUpsertRequest request) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    return professionalDirectoryService.create(principal.getTenantId(), request);
  }

  @PutMapping("/{id}")
  public ProfessionalResponse update(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("id") long id,
      @Valid @RequestBody ProfessionalUpsertRequest request) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    return professionalDirectoryService.update(principal.getTenantId(), id, request);
  }

  @PostMapping("/{id}/deactivate")
  public ProfessionalResponse deactivate(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable("id") long id) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    return professionalDirectoryService.deactivate(principal.getTenantId(), id);
  }

  @PutMapping("/{id}/schedules")
  public ProfessionalResponse updateSchedules(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("id") long id,
      @Valid @RequestBody @NotNull List<ProfessionalScheduleRequest> schedules) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    return professionalDirectoryService.updateSchedules(principal.getTenantId(), id, schedules);
  }
}
