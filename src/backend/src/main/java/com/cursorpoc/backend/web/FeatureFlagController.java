package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.FeatureFlagService;
import com.cursorpoc.backend.service.SifenHomologationStatusService;
import com.cursorpoc.backend.web.dto.FeatureFlagResponse;
import com.cursorpoc.backend.web.dto.FeatureFlagsResolvedResponse;
import com.cursorpoc.backend.web.dto.FeatureGlobalUpdateRequest;
import com.cursorpoc.backend.web.dto.TenantFeatureFlagOverrideRequest;
import com.cursorpoc.backend.web.dto.TenantFeatureFlagRowResponse;
import com.cursorpoc.backend.web.dto.TenantSifenHomologationResponse;
import com.cursorpoc.backend.web.dto.TenantSifenHomologationUpdateRequest;
import jakarta.validation.Valid;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
public class FeatureFlagController {

  private static final Logger log = LoggerFactory.getLogger(FeatureFlagController.class);

  private final FeatureFlagService featureFlagService;
  private final SifenHomologationStatusService sifenHomologationStatusService;

  public FeatureFlagController(
      FeatureFlagService featureFlagService,
      SifenHomologationStatusService sifenHomologationStatusService) {
    this.featureFlagService = featureFlagService;
    this.sifenHomologationStatusService = sifenHomologationStatusService;
  }

  @GetMapping("/api/feature-flags")
  public FeatureFlagsResolvedResponse getResolvedForCurrentTenant(
      @AuthenticationPrincipal FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    long tenantId = principal.getTenantId();
    log.info("GET /api/feature-flags path=/api/feature-flags method=GET tenantId={}", tenantId);
    var map = featureFlagService.resolveAll(tenantId);
    log.info("GET /api/feature-flags tenantId={} status=200", tenantId);
    return new FeatureFlagsResolvedResponse(map);
  }

  // HU-36: the endpoints below are gated to PLATFORM_ADMIN only (requirePlatformAdmin) and are one
  // of the explicit "platform routes" carved out of JwtAuthenticationFilter's tenant-optional
  // allowlist alongside /api/platform/**, /api/auth/**, and /api/me — a PLATFORM_ADMIN's
  // tenant-less
  // token cannot authenticate on any other /api/admin/** path. Because the caller is guaranteed
  // tenant-independent by that check, {tenantId} path segments below are the explicit, deliberate
  // target of the action — never matched against TenantPathAccess (retired here per HU-36 AC-3: no
  // bypass on tenant-scoped routes).

  @GetMapping("/api/admin/feature-flags")
  public List<FeatureFlagResponse> listGlobals(
      @AuthenticationPrincipal FemmeUserPrincipal principal) {
    requirePlatformAdmin(principal);
    log.info("GET /api/admin/feature-flags method=GET tenantId=null");
    List<FeatureFlagResponse> out = featureFlagService.listAllGlobals();
    log.info("GET /api/admin/feature-flags tenantId=null status=200");
    return out;
  }

  @PutMapping("/api/admin/feature-flags/{flagKey}")
  public FeatureFlagResponse updateGlobal(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("flagKey") String flagKey,
      @Valid @RequestBody FeatureGlobalUpdateRequest request) {
    requirePlatformAdmin(principal);
    log.info("PUT /api/admin/feature-flags/{} method=PUT tenantId=null", flagKey);
    try {
      FeatureFlagResponse out = featureFlagService.updateGlobal(flagKey, request);
      log.info("PUT /api/admin/feature-flags/{} tenantId=null status=200", flagKey);
      return out;
    } catch (ResponseStatusException ex) {
      log.error(
          "PUT /api/admin/feature-flags/{} tenantId=null status={}", flagKey, ex.getStatusCode());
      throw ex;
    }
  }

  @GetMapping("/api/admin/feature-flags/tenants/{tenantId}")
  public List<TenantFeatureFlagRowResponse> listTenantView(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("tenantId") long tenantId) {
    requirePlatformAdmin(principal);
    log.info("GET /api/admin/feature-flags/tenants/{} method=GET tenantId={}", tenantId, tenantId);
    List<TenantFeatureFlagRowResponse> out = featureFlagService.listTenantView(tenantId);
    log.info("GET /api/admin/feature-flags/tenants/{} tenantId={} status=200", tenantId, tenantId);
    return out;
  }

  @PutMapping("/api/admin/feature-flags/tenants/{tenantId}/{flagKey}")
  public ResponseEntity<Void> upsertTenantOverride(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("tenantId") long tenantId,
      @PathVariable("flagKey") String flagKey,
      @Valid @RequestBody TenantFeatureFlagOverrideRequest request) {
    requirePlatformAdmin(principal);
    log.info(
        "PUT /api/admin/feature-flags/tenants/{}/{} method=PUT tenantId={}",
        tenantId,
        flagKey,
        tenantId);
    try {
      featureFlagService.upsertTenantOverride(
          tenantId, flagKey, request, principal.getUserId(), principal.getUsername());
      log.info(
          "PUT /api/admin/feature-flags/tenants/{}/{} tenantId={} status=204",
          tenantId,
          flagKey,
          tenantId);
      return ResponseEntity.noContent().build();
    } catch (ResponseStatusException ex) {
      log.error(
          "PUT /api/admin/feature-flags/tenants/{}/{} tenantId={} status={}",
          tenantId,
          flagKey,
          tenantId,
          ex.getStatusCode());
      throw ex;
    }
  }

  @DeleteMapping("/api/admin/feature-flags/tenants/{tenantId}/{flagKey}")
  public ResponseEntity<Void> deleteTenantOverride(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("tenantId") long tenantId,
      @PathVariable("flagKey") String flagKey) {
    requirePlatformAdmin(principal);
    log.info(
        "DELETE /api/admin/feature-flags/tenants/{}/{} method=DELETE tenantId={}",
        tenantId,
        flagKey,
        tenantId);
    try {
      featureFlagService.deleteTenantOverride(
          tenantId, flagKey, principal.getUserId(), principal.getUsername());
      log.info(
          "DELETE /api/admin/feature-flags/tenants/{}/{} tenantId={} status=204",
          tenantId,
          flagKey,
          tenantId);
      return ResponseEntity.noContent().build();
    } catch (ResponseStatusException ex) {
      log.error(
          "DELETE /api/admin/feature-flags/tenants/{}/{} tenantId={} status={}",
          tenantId,
          flagKey,
          tenantId,
          ex.getStatusCode());
      throw ex;
    }
  }

  @GetMapping("/api/admin/feature-flags/tenants/{tenantId}/sifen-homologation")
  public TenantSifenHomologationResponse getSifenHomologationStatus(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("tenantId") long tenantId) {
    requirePlatformAdmin(principal);
    log.info(
        "GET /api/admin/feature-flags/tenants/{}/sifen-homologation method=GET tenantId={}",
        tenantId,
        tenantId);
    TenantSifenHomologationResponse out = sifenHomologationStatusService.getStatus(tenantId);
    log.info(
        "GET /api/admin/feature-flags/tenants/{}/sifen-homologation tenantId={} status=200",
        tenantId,
        tenantId);
    return out;
  }

  @PutMapping("/api/admin/feature-flags/tenants/{tenantId}/sifen-homologation")
  public TenantSifenHomologationResponse setSifenHomologationStatus(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("tenantId") long tenantId,
      @Valid @RequestBody TenantSifenHomologationUpdateRequest request) {
    requirePlatformAdmin(principal);
    log.info(
        "PUT /api/admin/feature-flags/tenants/{}/sifen-homologation method=PUT tenantId={}",
        tenantId,
        tenantId);
    try {
      TenantSifenHomologationResponse out =
          sifenHomologationStatusService.setStatus(
              tenantId, request.status(), principal.getUserId(), principal.getUsername());
      log.info(
          "PUT /api/admin/feature-flags/tenants/{}/sifen-homologation tenantId={} status=200",
          tenantId,
          tenantId);
      return out;
    } catch (ResponseStatusException ex) {
      log.error(
          "PUT /api/admin/feature-flags/tenants/{}/sifen-homologation tenantId={} status={}",
          tenantId,
          tenantId,
          ex.getStatusCode());
      throw ex;
    }
  }

  private static void requirePlatformAdmin(FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    if (principal.getRole() != UserRole.PLATFORM_ADMIN) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
  }
}
