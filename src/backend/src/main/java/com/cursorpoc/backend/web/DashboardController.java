package com.cursorpoc.backend.web;

import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.ClientBirthdayService;
import com.cursorpoc.backend.service.DashboardService;
import com.cursorpoc.backend.web.dto.ClientBirthdaysResponse;
import com.cursorpoc.backend.web.dto.DashboardResponse;
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

@RestController
@RequestMapping("/api/dashboard")
public class DashboardController {

  private static final Logger log = LoggerFactory.getLogger(DashboardController.class);

  private final DashboardService dashboardService;
  private final ClientBirthdayService clientBirthdayService;

  public DashboardController(
      DashboardService dashboardService, ClientBirthdayService clientBirthdayService) {
    this.dashboardService = dashboardService;
    this.clientBirthdayService = clientBirthdayService;
  }

  /** HU-69: active clients with a birthday today or in the next days. */
  @GetMapping("/birthdays")
  public ClientBirthdaysResponse birthdays(@AuthenticationPrincipal FemmeUserPrincipal principal) {
    if (principal == null) {
      log.error("GET /api/dashboard/birthdays tenantId=unknown status=401");
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    log.info("GET /api/dashboard/birthdays tenantId={}", principal.getTenantId());
    ClientBirthdaysResponse response = clientBirthdayService.birthdays(principal.getTenantId());
    log.info("GET /api/dashboard/birthdays tenantId={} status=200", principal.getTenantId());
    return response;
  }

  @GetMapping
  public DashboardResponse get(@AuthenticationPrincipal FemmeUserPrincipal principal) {
    if (principal == null) {
      log.error("GET /api/dashboard tenantId=unknown status=401");
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    log.info("GET /api/dashboard tenantId={}", principal.getTenantId());
    DashboardResponse response = dashboardService.build(principal.getTenantId());
    log.info("GET /api/dashboard tenantId={} status=200", principal.getTenantId());
    return response;
  }

  /** Issue #216 follow-up: the "Ver todas" full, paginated inactive-clients list. */
  @GetMapping("/inactive-clients")
  public PageResponse<DashboardResponse.InactiveClient> inactiveClients(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @RequestParam(name = "page", defaultValue = "0") int page,
      @RequestParam(name = "size", defaultValue = "10") int size) {
    if (principal == null) {
      log.error("GET /api/dashboard/inactive-clients tenantId=unknown status=401");
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    log.info(
        "GET /api/dashboard/inactive-clients tenantId={} page={} size={}",
        principal.getTenantId(),
        page,
        size);
    PageResponse<DashboardResponse.InactiveClient> response =
        dashboardService.buildInactiveClientsPage(principal.getTenantId(), page, size);
    log.info(
        "GET /api/dashboard/inactive-clients tenantId={} status=200 total={}",
        principal.getTenantId(),
        response.totalElements());
    return response;
  }
}
