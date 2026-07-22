package com.cursorpoc.backend.web;

import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.ServiceRecordService;
import com.cursorpoc.backend.web.dto.PagedServiceRecordsResponse;
import com.cursorpoc.backend.web.dto.ServiceRecordRequest;
import com.cursorpoc.backend.web.dto.ServiceRecordResponse;
import com.cursorpoc.backend.web.dto.ServiceRecordVoidRequest;
import jakarta.validation.Valid;
import java.time.Instant;
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
    Instant fromInstant = from != null ? Instant.parse(from) : null;
    Instant toInstant = to != null ? Instant.parse(to) : null;
    PagedServiceRecordsResponse response =
        serviceRecordService.listServiceRecords(
            principal.getTenantId(), fromInstant, toInstant, clientId, status, q, page, size);
    return ResponseEntity.ok(response);
  }

  @GetMapping("/{id}")
  public ResponseEntity<ServiceRecordResponse> get(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable Long id) {
    requirePrincipal(principal);
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

  private static void requirePrincipal(FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
  }
}
