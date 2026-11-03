package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.ServiceRecordService;
import com.cursorpoc.backend.web.dto.PagedServiceRecordsResponse;
import com.cursorpoc.backend.web.dto.ServiceRecordListItemResponse;
import com.cursorpoc.backend.web.dto.ServiceRecordRequest;
import com.cursorpoc.backend.web.dto.ServiceRecordResponse;
import com.cursorpoc.backend.web.dto.ServiceRecordVoidRequest;
import com.cursorpoc.backend.web.dto.ServiceResponse;
import jakarta.validation.Valid;
import java.time.Instant;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
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
@RequestMapping("/api/service-records")
public class ServiceRecordController {

  private static final org.slf4j.Logger log =
      org.slf4j.LoggerFactory.getLogger(ServiceRecordController.class);

  private final ServiceRecordService serviceRecordService;

  public ServiceRecordController(ServiceRecordService serviceRecordService) {
    this.serviceRecordService = serviceRecordService;
  }

  @PostMapping
  public ResponseEntity<ServiceRecordResponse> create(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @Valid @RequestBody ServiceRecordRequest request) {
    requirePrincipal(principal);
    ServiceRecordResponse response =
        serviceRecordService.createServiceRecord(principal.getTenantId(), request);
    return ResponseEntity.status(HttpStatus.CREATED).body(response);
  }

  @PutMapping("/{id}")
  public ResponseEntity<ServiceRecordResponse> update(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable Long id,
      @Valid @RequestBody ServiceRecordRequest request) {
    requirePrincipal(principal);
    if (isProfessional(principal)) {
      return ResponseEntity.ok(
          serviceRecordService.updateServicesAsProfessional(
              principal.getTenantId(), id, request, principal.getProfessionalId()));
    }
    ServiceRecordResponse response =
        serviceRecordService.updateServiceRecord(principal.getTenantId(), id, request);
    return ResponseEntity.ok(response);
  }

  @GetMapping
  public ResponseEntity<PagedServiceRecordsResponse> list(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @RequestParam(required = false) String from,
      @RequestParam(required = false) String to,
      @RequestParam(required = false) Long clientId,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) String q,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "10") int size) {
    requirePrincipal(principal);
    if (isProfessional(principal)) {
      // Professionals only get the open fichas of today, whatever filters they send.
      List<ServiceRecordListItemResponse> today =
          serviceRecordService.listOpenTodayForProfessional(principal.getTenantId());
      return ResponseEntity.ok(
          new PagedServiceRecordsResponse(today, 0, Math.max(1, today.size()), today.size(), 1));
    }
    Instant fromInstant = from != null ? Instant.parse(from) : null;
    Instant toInstant = to != null ? Instant.parse(to) : null;
    PagedServiceRecordsResponse response =
        serviceRecordService.listServiceRecords(
            principal.getTenantId(), fromInstant, toInstant, clientId, status, q, page, size);
    return ResponseEntity.ok(response);
  }

  /** The salon's most used services on its fichas (the editor's one-tap buttons); admin only. */
  @GetMapping("/frequent-services")
  public ResponseEntity<List<ServiceResponse>> frequentServices(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @RequestParam(defaultValue = "3") int limit) {
    requirePrincipal(principal);
    log.info(
        "GET /api/service-records/frequent-services tenantId={} limit={}",
        principal.getTenantId(),
        limit);
    List<ServiceResponse> response =
        serviceRecordService.frequentServices(principal.getTenantId(), limit);
    log.info(
        "GET /api/service-records/frequent-services tenantId={} status=200 count={}",
        principal.getTenantId(),
        response.size());
    return ResponseEntity.ok(response);
  }

  @GetMapping("/{id}")
  public ResponseEntity<ServiceRecordResponse> get(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable Long id) {
    requirePrincipal(principal);
    if (isProfessional(principal)) {
      return ResponseEntity.ok(
          serviceRecordService.getOpenTodayForProfessional(principal.getTenantId(), id));
    }
    ServiceRecordResponse response =
        serviceRecordService.getServiceRecord(principal.getTenantId(), id);
    return ResponseEntity.ok(response);
  }

  @PostMapping("/{id}/void")
  public ResponseEntity<ServiceRecordResponse> voidServiceRecord(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable Long id,
      @Valid @RequestBody ServiceRecordVoidRequest request) {
    requirePrincipal(principal);
    ServiceRecordResponse response =
        serviceRecordService.voidServiceRecord(principal.getTenantId(), id, request);
    return ResponseEntity.ok(response);
  }

  private static boolean isProfessional(FemmeUserPrincipal principal) {
    return principal.getRole() == UserRole.PROFESSIONAL;
  }

  private static void requirePrincipal(FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
  }
}
