package com.cursorpoc.backend.web;

import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.stock.StockAvailabilityService;
import com.cursorpoc.backend.stock.StockAvailabilityService.AvailabilityResponse;
import com.cursorpoc.backend.stock.StockSsoService;
import com.cursorpoc.backend.stock.StockSsoService.SsoToken;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Stock integration for salon users: SSO into the Stock SPA (HU-65) and product availability while
 * invoicing (HU-66).
 */
@RestController
public class StockController {

  private static final Logger log = LoggerFactory.getLogger(StockController.class);

  private static final int MAX_IDS = 100;

  private final StockSsoService ssoService;
  private final StockAvailabilityService availabilityService;

  public StockController(StockSsoService ssoService, StockAvailabilityService availabilityService) {
    this.ssoService = ssoService;
    this.availabilityService = availabilityService;
  }

  /** HU-65: ADMIN or PROFESSIONAL of a tenant with STOCK_MODULE; else 403. */
  @PostMapping("/api/sso/stock")
  public SsoToken sso(@AuthenticationPrincipal FemmeUserPrincipal principal) {
    if (principal == null || !principal.hasTenant()) {
      log.error("POST /api/sso/stock tenantId=null status=403");
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
    log.info(
        "POST /api/sso/stock tenantId={} role={}", principal.getTenantId(), principal.getRole());
    try {
      SsoToken token = ssoService.issue(principal);
      log.info("POST /api/sso/stock tenantId={} status=200", principal.getTenantId());
      return token;
    } catch (ResponseStatusException ex) {
      log.error(
          "POST /api/sso/stock tenantId={} status={} error={}",
          principal.getTenantId(),
          ex.getStatusCode().value(),
          ex.getReason());
      throw ex;
    }
  }

  /** HU-66: {@code ?serviceIds=1,2,3} → availability of the products among them. */
  @GetMapping("/api/stock/availability")
  public AvailabilityResponse availability(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @RequestParam(name = "serviceIds", defaultValue = "") String serviceIds) {
    if (principal == null || !principal.hasTenant()) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    Set<Long> ids = new LinkedHashSet<>();
    for (String raw : Arrays.stream(serviceIds.split(",")).map(String::trim).toList()) {
      if (raw.isEmpty()) {
        continue;
      }
      try {
        ids.add(Long.parseLong(raw));
      } catch (NumberFormatException e) {
        log.error(
            "GET /api/stock/availability tenantId={} status=400 error=INVALID_SERVICE_IDS",
            principal.getTenantId());
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_SERVICE_IDS");
      }
    }
    if (ids.size() > MAX_IDS) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_SERVICE_IDS");
    }
    log.info("GET /api/stock/availability tenantId={} ids={}", principal.getTenantId(), ids.size());
    AvailabilityResponse response = availabilityService.availability(principal.getTenantId(), ids);
    log.info(
        "GET /api/stock/availability tenantId={} status=200 unavailable={}",
        principal.getTenantId(),
        response.unavailable());
    return response;
  }
}
