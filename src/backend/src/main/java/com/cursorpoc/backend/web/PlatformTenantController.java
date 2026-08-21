package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.PlatformUserAdminService;
import com.cursorpoc.backend.service.TenantAdminService;
import com.cursorpoc.backend.web.dto.CreateTenantAdminRequest;
import com.cursorpoc.backend.web.dto.CreateTenantAdminResponse;
import com.cursorpoc.backend.web.dto.PageResponse;
import com.cursorpoc.backend.web.dto.TenantCreateRequest;
import com.cursorpoc.backend.web.dto.TenantResponse;
import com.cursorpoc.backend.web.dto.TenantStatusUpdateRequest;
import com.cursorpoc.backend.web.dto.TenantUpdateRequest;
import com.cursorpoc.backend.web.dto.TierOptionResponse;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Locale;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-37/HU-38/HU-40 (Épica B — Gestión de Tenants) and HU-41 (Épica C — Gestión de usuarios y
 * admins de tenant): Platform Admin creates, lists, edits, and suspends/reactivates tenants, and
 * invites their first/next tenant {@code ADMIN} users. These routes are tenant-independent (no
 * {@code tid} on the caller's token, see HU-34), so logging identifies the *acting* Platform Admin
 * user instead of a tenant id.
 */
@RestController
@RequestMapping("/api/platform/tenants")
public class PlatformTenantController {

  private static final Logger log = LoggerFactory.getLogger(PlatformTenantController.class);

  private final TenantAdminService tenantAdminService;
  private final PlatformUserAdminService platformUserAdminService;

  public PlatformTenantController(
      TenantAdminService tenantAdminService, PlatformUserAdminService platformUserAdminService) {
    this.tenantAdminService = tenantAdminService;
    this.platformUserAdminService = platformUserAdminService;
  }

  @GetMapping
  public PageResponse<TenantResponse> list(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @RequestParam(name = "page", defaultValue = "0") int page,
      @RequestParam(name = "size", defaultValue = "10") int size,
      @RequestParam(name = "q", required = false) String q) {
    requirePlatformAdmin(principal, "GET /api/platform/tenants");
    log.info(
        "GET /api/platform/tenants adminUserId={} page={} size={} q={}",
        principal.getUserId(),
        page,
        size,
        q);
    PageResponse<TenantResponse> response = tenantAdminService.listPaged(page, size, q);
    log.info(
        "GET /api/platform/tenants adminUserId={} status=200 total={}",
        principal.getUserId(),
        response.totalElements());
    return response;
  }

  @GetMapping("/tiers")
  public List<TierOptionResponse> listTiers(@AuthenticationPrincipal FemmeUserPrincipal principal) {
    requirePlatformAdmin(principal, "GET /api/platform/tenants/tiers");
    log.info("GET /api/platform/tenants/tiers adminUserId={}", principal.getUserId());
    List<TierOptionResponse> response = tenantAdminService.listTiers();
    log.info(
        "GET /api/platform/tenants/tiers adminUserId={} status=200 count={}",
        principal.getUserId(),
        response.size());
    return response;
  }

  @PostMapping
  public TenantResponse create(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @RequestBody TenantCreateRequest request) {
    requirePlatformAdmin(principal, "POST /api/platform/tenants");
    log.info("POST /api/platform/tenants adminUserId={}", principal.getUserId());
    try {
      TenantResponse response = tenantAdminService.create(request);
      log.info(
          "POST /api/platform/tenants adminUserId={} status=200 tenantId={}",
          principal.getUserId(),
          response.id());
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "POST /api/platform/tenants adminUserId={} status={} error={}",
          principal.getUserId(),
          ex.getStatusCode().value(),
          ex.getReason());
      throw ex;
    }
  }

  @PutMapping("/{id}")
  public TenantResponse update(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("id") Long id,
      @RequestBody TenantUpdateRequest request) {
    requirePlatformAdmin(principal, "PUT /api/platform/tenants/{id}");
    log.info(
        "PUT /api/platform/tenants/{} adminUserId={} tenantId={}", id, principal.getUserId(), id);
    try {
      TenantResponse response =
          tenantAdminService.update(id, request, principal.getUserId(), principal.getUsername());
      log.info(
          "PUT /api/platform/tenants/{} adminUserId={} tenantId={} status=200",
          id,
          principal.getUserId(),
          id);
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "PUT /api/platform/tenants/{} adminUserId={} tenantId={} status={} error={}",
          id,
          principal.getUserId(),
          id,
          ex.getStatusCode().value(),
          ex.getReason());
      throw ex;
    }
  }

  /** HU-40 AC-1/AC-4: Platform Admin suspends or reactivates a tenant. */
  @PatchMapping("/{id}/status")
  public TenantResponse updateStatus(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("id") Long id,
      @RequestBody TenantStatusUpdateRequest request) {
    requirePlatformAdmin(principal, "PATCH /api/platform/tenants/{id}/status");
    log.info(
        "PATCH /api/platform/tenants/{}/status adminUserId={} tenantId={} newStatus={}",
        id,
        principal.getUserId(),
        id,
        request.status());
    try {
      TenantResponse response =
          tenantAdminService.updateStatus(
              id, request, principal.getUserId(), principal.getUsername());
      log.info(
          "PATCH /api/platform/tenants/{}/status adminUserId={} tenantId={} status=200 newStatus={}",
          id,
          principal.getUserId(),
          id,
          response.status());
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "PATCH /api/platform/tenants/{}/status adminUserId={} tenantId={} status={} error={}",
          id,
          principal.getUserId(),
          id,
          ex.getStatusCode().value(),
          ex.getReason());
      throw ex;
    }
  }

  /** HU-41 AC-1/AC-4/AC-6: Platform Admin creates and invites a tenant {@code ADMIN} user. */
  @PostMapping("/{id}/admins")
  public CreateTenantAdminResponse createAdmin(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("id") Long id,
      @Valid @RequestBody CreateTenantAdminRequest request,
      Locale locale) {
    requirePlatformAdmin(principal, "POST /api/platform/tenants/{id}/admins");
    log.info(
        "POST /api/platform/tenants/{}/admins adminUserId={} tenantId={}",
        id,
        principal.getUserId(),
        id);
    try {
      CreateTenantAdminResponse response =
          platformUserAdminService.createTenantAdmin(id, request, locale);
      log.info(
          "POST /api/platform/tenants/{}/admins adminUserId={} tenantId={} status=200 newUserId={}",
          id,
          principal.getUserId(),
          id,
          response.userId());
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "POST /api/platform/tenants/{}/admins adminUserId={} tenantId={} status={} error={}",
          id,
          principal.getUserId(),
          id,
          ex.getStatusCode().value(),
          ex.getReason());
      throw ex;
    }
  }

  private static void requirePlatformAdmin(FemmeUserPrincipal principal, String routeLabel) {
    if (principal == null) {
      log.error("{} status=401 - no principal", routeLabel);
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    if (principal.getRole() != UserRole.PLATFORM_ADMIN) {
      log.error(
          "{} status=403 - role={} is not PLATFORM_ADMIN", routeLabel, principal.getRole().name());
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
  }
}
