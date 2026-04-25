package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.FeatureFlagService;
import com.cursorpoc.backend.web.dto.FeatureFlagResponse;
import com.cursorpoc.backend.web.dto.FeatureFlagsResolvedResponse;
import com.cursorpoc.backend.web.dto.FeatureGlobalUpdateRequest;
import com.cursorpoc.backend.web.dto.TenantFeatureFlagOverrideRequest;
import com.cursorpoc.backend.web.dto.TenantFeatureFlagRowResponse;
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

  public FeatureFlagController(FeatureFlagService featureFlagService) {
    this.featureFlagService = featureFlagService;
  }

  @GetMapping("/api/feature-flags")
  public FeatureFlagsResolvedResponse getResolvedForCurrentTenant(
      @AuthenticationPrincipal FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    long tenantId = principal.getTenantId();
    log.info("GET /api/feature-flags tenantId={}", tenantId);
    var map = featureFlagService.resolveAll(tenantId);
    log.info("GET /api/feature-flags tenantId={} status=200", tenantId);
    return new FeatureFlagsResolvedResponse(map);
  }

  @GetMapping("/api/admin/feature-flags")
  public List<FeatureFlagResponse> listGlobals(
      @AuthenticationPrincipal FemmeUserPrincipal principal) {
    requireAdmin(principal);
    long tenantId = principal.getTenantId();
    log.info("GET /api/admin/feature-flags tenantId={}", tenantId);
    List<FeatureFlagResponse> out = featureFlagService.listAllGlobals();
    log.info("GET /api/admin/feature-flags tenantId={} status=200", tenantId);
    return out;
  }

  @PutMapping("/api/admin/feature-flags/{flagKey}")
  public FeatureFlagResponse updateGlobal(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("flagKey") String flagKey,
      @Valid @RequestBody FeatureGlobalUpdateRequest request) {
    requireAdmin(principal);
    long tenantId = principal.getTenantId();
    log.info("PUT /api/admin/feature-flags/{} tenantId={}", flagKey, tenantId);
    try {
      FeatureFlagResponse out = featureFlagService.updateGlobal(flagKey, request);
      log.info("PUT /api/admin/feature-flags/{} tenantId={} status=200", flagKey, tenantId);
      return out;
    } catch (ResponseStatusException ex) {
      log.error(
          "PUT /api/admin/feature-flags/{} tenantId={} status={}",
          flagKey,
          tenantId,
          ex.getStatusCode());
      throw ex;
    }
  }

  @GetMapping("/api/admin/feature-flags/tenants/{tenantId}")
  public List<TenantFeatureFlagRowResponse> listTenantView(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("tenantId") long tenantId) {
    requireAdmin(principal);
    requireAdminTenantPath(principal, tenantId);
    log.info(
        "GET /api/admin/feature-flags/tenants/{} tenantId={}", tenantId, principal.getTenantId());
    List<TenantFeatureFlagRowResponse> out = featureFlagService.listTenantView(tenantId);
    log.info(
        "GET /api/admin/feature-flags/tenants/{} tenantId={} status=200",
        tenantId,
        principal.getTenantId());
    return out;
  }

  @PutMapping("/api/admin/feature-flags/tenants/{tenantId}/{flagKey}")
  public ResponseEntity<Void> upsertTenantOverride(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("tenantId") long tenantId,
      @PathVariable("flagKey") String flagKey,
      @Valid @RequestBody TenantFeatureFlagOverrideRequest request) {
    requireAdmin(principal);
    requireAdminTenantPath(principal, tenantId);
    log.info(
        "PUT /api/admin/feature-flags/tenants/{}/{} tenantId={}",
        tenantId,
        flagKey,
        principal.getTenantId());
    try {
      featureFlagService.upsertTenantOverride(tenantId, flagKey, request);
      log.info(
          "PUT /api/admin/feature-flags/tenants/{}/{} tenantId={} status=204",
          tenantId,
          flagKey,
          principal.getTenantId());
      return ResponseEntity.noContent().build();
    } catch (ResponseStatusException ex) {
      log.error(
          "PUT /api/admin/feature-flags/tenants/{}/{} tenantId={} status={}",
          tenantId,
          flagKey,
          principal.getTenantId(),
          ex.getStatusCode());
      throw ex;
    }
  }

  @DeleteMapping("/api/admin/feature-flags/tenants/{tenantId}/{flagKey}")
  public ResponseEntity<Void> deleteTenantOverride(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("tenantId") long tenantId,
      @PathVariable("flagKey") String flagKey) {
    requireAdmin(principal);
    requireAdminTenantPath(principal, tenantId);
    log.info(
        "DELETE /api/admin/feature-flags/tenants/{}/{} tenantId={}",
        tenantId,
        flagKey,
        principal.getTenantId());
    try {
      featureFlagService.deleteTenantOverride(tenantId, flagKey);
      log.info(
          "DELETE /api/admin/feature-flags/tenants/{}/{} tenantId={} status=204",
          tenantId,
          flagKey,
          principal.getTenantId());
      return ResponseEntity.noContent().build();
    } catch (ResponseStatusException ex) {
      log.error(
          "DELETE /api/admin/feature-flags/tenants/{}/{} tenantId={} status={}",
          tenantId,
          flagKey,
          principal.getTenantId(),
          ex.getStatusCode());
      throw ex;
    }
  }

  private static void requireAdmin(FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    if (principal.getRole() != UserRole.ADMIN) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
  }

  /** Admins may only read or change tenant overrides for their own tenant. */
  private static void requireAdminTenantPath(FemmeUserPrincipal principal, long pathTenantId) {
    if (pathTenantId != principal.getTenantId()) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
  }
}
