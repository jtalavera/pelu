package com.cursorpoc.backend.web;

import com.cursorpoc.backend.service.DashboardService;
import com.cursorpoc.backend.service.TenantContext;
import com.cursorpoc.backend.web.dto.DashboardResponse;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(path = "/api/dashboard", produces = MediaType.APPLICATION_JSON_VALUE)
public class DashboardController {

  private final DashboardService dashboardService;

  public DashboardController(DashboardService dashboardService) {
    this.dashboardService = dashboardService;
  }

  @GetMapping
  public DashboardResponse dashboard() {
    return dashboardService.build(TenantContext.requireTenantId());
  }
}
