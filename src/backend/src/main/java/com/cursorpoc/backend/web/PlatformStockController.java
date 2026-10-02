package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.stock.StockAdminService;
import com.cursorpoc.backend.stock.StockAdminService.OutboxEventRow;
import com.cursorpoc.backend.stock.StockAdminService.OutboxSummary;
import com.cursorpoc.backend.stock.StockAdminService.TenantStockStatus;
import com.cursorpoc.backend.web.dto.PageResponse;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Stock integration (HU-62/HU-67): Platform Admin endpoints — the outbox support panel and the
 * per-tenant Stock status / manual catalog sync.
 */
@RestController
public class PlatformStockController {

  private static final Logger log = LoggerFactory.getLogger(PlatformStockController.class);

  private final StockAdminService adminService;

  public PlatformStockController(StockAdminService adminService) {
    this.adminService = adminService;
  }

  @GetMapping("/api/platform/stock/outbox")
  public PageResponse<OutboxEventRow> list(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @RequestParam(name = "tenantId", required = false) Long tenantId,
      @RequestParam(name = "status", required = false) String status,
      @RequestParam(name = "page", defaultValue = "0") int page,
      @RequestParam(name = "size", defaultValue = "20") int size) {
    return run(
        principal,
        "GET /api/platform/stock/outbox",
        tenantId,
        () -> adminService.list(tenantId, status, page, size));
  }

  @GetMapping("/api/platform/stock/summary")
  public OutboxSummary summary(@AuthenticationPrincipal FemmeUserPrincipal principal) {
    return run(principal, "GET /api/platform/stock/summary", null, adminService::summary);
  }

  @PostMapping("/api/platform/stock/outbox/{id}/retry")
  public OutboxEventRow retry(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable("id") long id) {
    return run(
        principal,
        "POST /api/platform/stock/outbox/{id}/retry",
        null,
        () -> adminService.retry(id));
  }

  @PostMapping("/api/platform/stock/outbox/{id}/discard")
  public OutboxEventRow discard(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable("id") long id) {
    return run(
        principal,
        "POST /api/platform/stock/outbox/{id}/discard",
        null,
        () -> adminService.discard(id));
  }

  @GetMapping("/api/platform/tenants/{tenantId}/stock")
  public TenantStockStatus tenantStatus(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("tenantId") long tenantId) {
    return run(
        principal,
        "GET /api/platform/tenants/{tenantId}/stock",
        tenantId,
        () -> adminService.tenantStatus(tenantId));
  }

  @PostMapping("/api/platform/tenants/{tenantId}/stock/catalog-sync")
  public TenantStockStatus catalogSync(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("tenantId") long tenantId) {
    return run(
        principal,
        "POST /api/platform/tenants/{tenantId}/stock/catalog-sync",
        tenantId,
        () -> adminService.requestCatalogSync(tenantId));
  }

  private static <T> T run(
      FemmeUserPrincipal principal, String route, Long tenantId, Supplier<T> action) {
    if (principal == null) {
      log.error("{} tenantId={} status=401", route, tenantId);
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    if (principal.getRole() != UserRole.PLATFORM_ADMIN) {
      log.error("{} tenantId={} status=403 role={}", route, tenantId, principal.getRole());
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
    log.info("{} tenantId={} adminUserId={}", route, tenantId, principal.getUserId());
    try {
      T result = action.get();
      log.info("{} tenantId={} status=200", route, tenantId);
      return result;
    } catch (ResponseStatusException ex) {
      log.error(
          "{} tenantId={} status={} error={}",
          route,
          tenantId,
          ex.getStatusCode().value(),
          ex.getReason());
      throw ex;
    }
  }
}
