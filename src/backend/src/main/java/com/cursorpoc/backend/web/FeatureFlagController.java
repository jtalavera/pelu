package com.cursorpoc.backend.web;

import com.cursorpoc.backend.config.FemmeSystemAdminProperties;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.security.TenantPathAccess;
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
  private final FemmeSystemAdminProperties systemAdminProperties;

  public FeatureFlagController(
      FeatureFlagService featureFlagService, FemmeSystemAdminProperties systemAdminProperties) {
    this.featureFlagService = featureFlagService;
    this.systemAdminProperties = systemAdminProperties;
  }

  @GetMapping("/api/feature-flags")
  public FeatureFlagsResolvedResponse getResolvedForCurrentTenant(
      @AuthenticationPrincipal FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    long effectiveTenantId =
        principal.getRole() == UserRole.SYSTEM_ADMIN
            ? systemAdminProperties.getTenantId()
            : principal.getTenantId();
    log.info(
        "GET /api/feature-flags path=/api/feature-flags method=GET tenantId={} effectiveTenantId={}",
        principal.getTenantId(),
        effectiveTenantId);
    var map = featureFlagService.resolveAll(effectiveTenantId);
    log.info("GET /api/feature-flags tenantId={} status=200", principal.getTenantId());
    return new FeatureFlagsResolvedResponse(map);
  }

  @GetMapping("/api/admin/feature-flags")
  public List<FeatureFlagResponse> listGlobals(
      @AuthenticationPrincipal FemmeUserPrincipal principal) {
    requireSystemAdmin(principal);
    long tenantId = principal.getTenantId();
    log.info("GET /api/admin/feature-flags method=GET tenantId={}", tenantId);
    List<FeatureFlagResponse> out = featureFlagService.listAllGlobals();
    log.info("GET /api/admin/feature-flags tenantId={} status=200", tenantId);
    return out;
  }

  @PutMapping("/api/admin/feature-flags/{flagKey}")
  public FeatureFlagResponse updateGlobal(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("flagKey") String flagKey,
      @Valid @RequestBody FeatureGlobalUpdateRequest request) {
    requireSystemAdmin(principal);
    long tenantId = principal.getTenantId();
    log.info("PUT /api/admin/feature-flags/{} method=PUT tenantId={}", flagKey, tenantId);
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
    requireSystemAdmin(principal);
    TenantPathAccess.requirePathTenantMatchesJwt(principal, tenantId);
    log.info(
        "GET /api/admin/feature-flags/tenants/{} method=GET tenantId={}",
        tenantId,
        principal.getTenantId());
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
    requireSystemAdmin(principal);
    TenantPathAccess.requirePathTenantMatchesJwt(principal, tenantId);
    log.info(
        "PUT /api/admin/feature-flags/tenants/{}/{} method=PUT tenantId={}",
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
    requireSystemAdmin(principal);
    TenantPathAccess.requirePathTenantMatchesJwt(principal, tenantId);
    log.info(
        "DELETE /api/admin/feature-flags/tenants/{}/{} method=DELETE tenantId={}",
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

  private static void requireSystemAdmin(FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    if (principal.getRole() != UserRole.SYSTEM_ADMIN) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
  }
}
