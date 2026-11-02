package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.AppointmentService;
import com.cursorpoc.backend.service.AppointmentServiceRecordService;
import com.cursorpoc.backend.service.ServiceRecordService;
import com.cursorpoc.backend.web.dto.AppointmentAssignServiceRecordRequest;
import com.cursorpoc.backend.web.dto.ServiceRecordListItemResponse;
import com.cursorpoc.backend.web.dto.ServiceRecordResponse;
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
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Turno ↔ ficha de servicio: create the turno's ficha, assign an open one, list the assignable
 * ones. A professional only acts on her own turnos and never receives amounts.
 */
@RestController
@RequestMapping("/api/appointments/{appointmentId:\\d+}/service-record")
public class AppointmentServiceRecordController {

  private static final Logger log =
      LoggerFactory.getLogger(AppointmentServiceRecordController.class);

  private final AppointmentServiceRecordService linkService;
  private final AppointmentService appointmentService;

  public AppointmentServiceRecordController(
      AppointmentServiceRecordService linkService, AppointmentService appointmentService) {
    this.linkService = linkService;
    this.appointmentService = appointmentService;
  }

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  public ServiceRecordResponse create(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("appointmentId") long appointmentId) {
    requirePrincipal(principal);
    requireOwnAppointment(principal, appointmentId);
    log.info(
        "POST /api/appointments/{}/service-record tenantId={}",
        appointmentId,
        principal.getTenantId());
    ServiceRecordResponse response =
        linkService.createFromAppointment(principal.getTenantId(), appointmentId);
    log.info(
        "POST /api/appointments/{}/service-record tenantId={} status=201",
        appointmentId,
        principal.getTenantId());
    return forRole(principal, response);
  }

  @PostMapping("/assign")
  public ServiceRecordResponse assign(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("appointmentId") long appointmentId,
      @Valid @RequestBody AppointmentAssignServiceRecordRequest request) {
    requirePrincipal(principal);
    requireOwnAppointment(principal, appointmentId);
    log.info(
        "POST /api/appointments/{}/service-record/assign tenantId={} serviceRecordId={}",
        appointmentId,
        principal.getTenantId(),
        request.serviceRecordId());
    ServiceRecordResponse response =
        linkService.assign(principal.getTenantId(), appointmentId, request.serviceRecordId());
    log.info(
        "POST /api/appointments/{}/service-record/assign tenantId={} status=200",
        appointmentId,
        principal.getTenantId());
    return forRole(principal, response);
  }

  @GetMapping("/candidates")
  public List<ServiceRecordListItemResponse> candidates(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("appointmentId") long appointmentId) {
    requirePrincipal(principal);
    requireOwnAppointment(principal, appointmentId);
    log.info(
        "GET /api/appointments/{}/service-record/candidates tenantId={}",
        appointmentId,
        principal.getTenantId());
    List<ServiceRecordListItemResponse> list =
        linkService.candidates(principal.getTenantId(), appointmentId);
    log.info(
        "GET /api/appointments/{}/service-record/candidates tenantId={} status=200 count={}",
        appointmentId,
        principal.getTenantId(),
        list.size());
    return isProfessional(principal)
        ? list.stream().map(ServiceRecordService::maskAmounts).toList()
        : list;
  }

  private static ServiceRecordResponse forRole(
      FemmeUserPrincipal principal, ServiceRecordResponse response) {
    return isProfessional(principal) ? ServiceRecordService.maskAmounts(response) : response;
  }

  private static boolean isProfessional(FemmeUserPrincipal principal) {
    return principal.getRole() == UserRole.PROFESSIONAL;
  }

  /** A professional only works on her own turnos. */
  private void requireOwnAppointment(FemmeUserPrincipal principal, long appointmentId) {
    if (!isProfessional(principal)) {
      return;
    }
    Long ownId = principal.getProfessionalId();
    long professionalId =
        appointmentService.get(principal.getTenantId(), appointmentId).professionalId();
    if (ownId == null || ownId != professionalId) {
      throw new ResponseStatusException(
          HttpStatus.FORBIDDEN, AppointmentController.NOT_OWN_APPOINTMENT);
    }
  }

  private static void requirePrincipal(FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
  }
}
