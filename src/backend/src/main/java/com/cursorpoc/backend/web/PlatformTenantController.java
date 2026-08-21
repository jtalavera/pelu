package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.PlatformUserAdminService;
import com.cursorpoc.backend.service.TenantAdminService;
import com.cursorpoc.backend.web.dto.AppUserStatusUpdateRequest;
import com.cursorpoc.backend.web.dto.CreateTenantAdminRequest;
import com.cursorpoc.backend.web.dto.CreateTenantAdminResponse;
import com.cursorpoc.backend.web.dto.PageResponse;
import com.cursorpoc.backend.web.dto.ResendInvitationResponse;
import com.cursorpoc.backend.web.dto.TenantCreateRequest;
import com.cursorpoc.backend.web.dto.TenantResponse;
import com.cursorpoc.backend.web.dto.TenantStatusUpdateRequest;
import com.cursorpoc.backend.web.dto.TenantUpdateRequest;
import com.cursorpoc.backend.web.dto.TenantUserResponse;
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
 * HU-37/HU-38/HU-40 (Épica B — Gestión de Tenants) and HU-41/HU-42/HU-43/HU-44 (Épica C — Gestión
 * de usuarios y admins de tenant): Platform Admin creates, lists, edits, and suspends/reactivates
 * tenants, invites tenant {@code ADMIN} users — any number of them, HU-42 AC-1 — lists everyone
 * assigned to a tenant, deactivates/reactivates a single tenant user without affecting the rest
 * (HU-43), and resends an activation invite or triggers a password reset for one (HU-44). These
 * routes are tenant-independent (no {@code tid} on the caller's token, see HU-34), so logging
 * identifies the *acting* Platform Admin user instead of a tenant id.
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

  /**
   * HU-42 AC-3: lists every user (admins and professionals with login access) assigned to this
   * tenant, from its detail — surfacing that a tenant can have more than one {@code ADMIN} (AC-1).
   */
  @GetMapping("/{id}/admins")
  public List<TenantUserResponse> listAdmins(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable("id") Long id) {
    requirePlatformAdmin(principal, "GET /api/platform/tenants/{id}/admins");
    log.info(
        "GET /api/platform/tenants/{}/admins adminUserId={} tenantId={}",
        id,
        principal.getUserId(),
        id);
    try {
      List<TenantUserResponse> response = platformUserAdminService.listTenantUsers(id);
      log.info(
          "GET /api/platform/tenants/{}/admins adminUserId={} tenantId={} status=200 count={}",
          id,
          principal.getUserId(),
          id,
          response.size());
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "GET /api/platform/tenants/{}/admins adminUserId={} tenantId={} status={} error={}",
          id,
          principal.getUserId(),
          id,
          ex.getStatusCode().value(),
          ex.getReason());
      throw ex;
    }
  }

  /** HU-43 AC-1/AC-3: Platform Admin deactivates or reactivates a single tenant user. */
  @PatchMapping("/{id}/admins/{userId}/status")
  public TenantUserResponse updateAdminStatus(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("id") Long id,
      @PathVariable("userId") Long userId,
      @RequestBody AppUserStatusUpdateRequest request) {
    requirePlatformAdmin(principal, "PATCH /api/platform/tenants/{id}/admins/{userId}/status");
    log.info(
        "PATCH /api/platform/tenants/{}/admins/{}/status adminUserId={} tenantId={} userId={} newEnabled={}",
        id,
        userId,
        principal.getUserId(),
        id,
        userId,
        request.enabled());
    try {
      TenantUserResponse response =
          platformUserAdminService.updateUserStatus(
              id, userId, request, principal.getUserId(), principal.getUsername());
      log.info(
          "PATCH /api/platform/tenants/{}/admins/{}/status adminUserId={} tenantId={} userId={} status=200 enabled={}",
          id,
          userId,
          principal.getUserId(),
          id,
          userId,
          response.enabled());
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "PATCH /api/platform/tenants/{}/admins/{}/status adminUserId={} tenantId={} userId={} status={} error={}",
          id,
          userId,
          principal.getUserId(),
          id,
          userId,
          ex.getStatusCode().value(),
          ex.getReason());
      throw ex;
    }
  }

  /**
   * HU-44 AC-1/AC-2/AC-3/AC-4: resends the activation invite for a user who never activated, or
   * triggers a password reset for one who already did but lost access — the response tells the
   * frontend which happened so it can show the right confirmation (AC-4).
   */
  @PostMapping("/{id}/admins/{userId}/resend-invitation")
  public ResendInvitationResponse resendInvitation(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("id") Long id,
      @PathVariable("userId") Long userId,
      Locale locale) {
    requirePlatformAdmin(
        principal, "POST /api/platform/tenants/{id}/admins/{userId}/resend-invitation");
    log.info(
        "POST /api/platform/tenants/{}/admins/{}/resend-invitation adminUserId={} tenantId={} userId={}",
        id,
        userId,
        principal.getUserId(),
        id,
        userId);
    try {
      ResendInvitationResponse response =
          platformUserAdminService.resendInvitation(id, userId, locale);
      log.info(
          "POST /api/platform/tenants/{}/admins/{}/resend-invitation adminUserId={} tenantId={} userId={} status=200 passwordReset={}",
          id,
          userId,
          principal.getUserId(),
          id,
          userId,
          response.passwordReset());
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "POST /api/platform/tenants/{}/admins/{}/resend-invitation adminUserId={} tenantId={} userId={} status={} error={}",
          id,
          userId,
          principal.getUserId(),
          id,
          userId,
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
