package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.AuditLogService;
import com.cursorpoc.backend.web.dto.AuditLogResponse;
import com.cursorpoc.backend.web.dto.PageResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Issue #284: the root user's "Auditoría" — who did what across the platform: every salon and the
 * root users' own actions (tenant {@code null}). Optional {@code tenantId} narrows it to one salon.
 */
@RestController
@RequestMapping("/api/platform/audit")
public class PlatformAuditController {

  private static final Logger log = LoggerFactory.getLogger(PlatformAuditController.class);

  private final AuditLogService auditLogService;

  public PlatformAuditController(AuditLogService auditLogService) {
    this.auditLogService = auditLogService;
  }

  @GetMapping
  public PageResponse<AuditLogResponse> list(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @RequestParam(required = false) Long tenantId,
      @RequestParam(required = false) String from,
      @RequestParam(required = false) String to,
      @RequestParam(required = false) String resource,
      @RequestParam(required = false) String q,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    if (principal.getRole() != UserRole.PLATFORM_ADMIN) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
    log.info("GET /api/platform/audit method=GET tenantId={}", tenantId == null ? "-" : tenantId);
    PageResponse<AuditLogResponse> out =
        auditLogService.search(tenantId, from, to, resource, q, page, size);
    log.info(
        "GET /api/platform/audit method=GET tenantId={} status=200",
        tenantId == null ? "-" : tenantId);
    return out;
  }
}
