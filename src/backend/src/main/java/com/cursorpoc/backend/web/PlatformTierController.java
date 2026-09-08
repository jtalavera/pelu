package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.TierAdminService;
import com.cursorpoc.backend.web.dto.TierCreateRequest;
import com.cursorpoc.backend.web.dto.TierFeatureFlagIncludeRequest;
import com.cursorpoc.backend.web.dto.TierFeatureFlagRowResponse;
import com.cursorpoc.backend.web.dto.TierResponse;
import com.cursorpoc.backend.web.dto.TierUpdateRequest;
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
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-45 (Épica D — Tiers y Feature Flags): Platform Admin creates, edits, lists, and deletes tiers
 * — reusable packages of feature flags that can later be assigned to tenants (HU-48) and
 * pre-populate their flags (HU-46, added below; HU-47 wires it into flag resolution, not
 * implemented by either story). Distinct from {@code GET /api/platform/tenants/tiers} (kept as-is):
 * that endpoint is the minimal option list the tenant create/edit form needs (HU-37); this one is
 * full tier administration. Tenant-independent (no {@code tid} on the caller's token, see HU-34),
 * so logging identifies the acting Platform Admin user instead of a tenant id.
 */
@RestController
@RequestMapping("/api/platform/tiers")
public class PlatformTierController {

  private static final Logger log = LoggerFactory.getLogger(PlatformTierController.class);

  private final TierAdminService tierAdminService;

  public PlatformTierController(TierAdminService tierAdminService) {
    this.tierAdminService = tierAdminService;
  }

  @GetMapping
  public List<TierResponse> list(@AuthenticationPrincipal FemmeUserPrincipal principal) {
    requirePlatformAdmin(principal, "GET /api/platform/tiers");
    log.info("GET /api/platform/tiers adminUserId={}", principal.getUserId());
    List<TierResponse> response = tierAdminService.listAll();
    log.info(
        "GET /api/platform/tiers adminUserId={} status=200 count={}",
        principal.getUserId(),
        response.size());
    return response;
  }

  @PostMapping
  public TierResponse create(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @RequestBody TierCreateRequest request) {
    requirePlatformAdmin(principal, "POST /api/platform/tiers");
    log.info("POST /api/platform/tiers adminUserId={}", principal.getUserId());
    try {
      TierResponse response = tierAdminService.create(request);
      log.info(
          "POST /api/platform/tiers adminUserId={} status=200 tierId={}",
          principal.getUserId(),
          response.id());
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "POST /api/platform/tiers adminUserId={} status={} error={}",
          principal.getUserId(),
          ex.getStatusCode().value(),
          ex.getReason());
      throw ex;
    }
  }

  @PutMapping("/{id}")
  public TierResponse update(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("id") Long id,
      @RequestBody TierUpdateRequest request) {
    requirePlatformAdmin(principal, "PUT /api/platform/tiers/{id}");
    log.info("PUT /api/platform/tiers/{} adminUserId={} tierId={}", id, principal.getUserId(), id);
    try {
      TierResponse response = tierAdminService.update(id, request);
      log.info(
          "PUT /api/platform/tiers/{} adminUserId={} tierId={} status=200",
          id,
          principal.getUserId(),
          id);
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "PUT /api/platform/tiers/{} adminUserId={} tierId={} status={} error={}",
          id,
          principal.getUserId(),
          id,
          ex.getStatusCode().value(),
          ex.getReason());
      throw ex;
    }
  }

  /**
   * HU-45 AC-3: rejects deletion (409 {@code TIER_IN_USE}) when at least one tenant uses this tier.
   */
  @DeleteMapping("/{id}")
  public ResponseEntity<Void> delete(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable("id") Long id) {
    requirePlatformAdmin(principal, "DELETE /api/platform/tiers/{id}");
    log.info(
        "DELETE /api/platform/tiers/{} adminUserId={} tierId={}", id, principal.getUserId(), id);
    try {
      tierAdminService.delete(id);
      log.info(
          "DELETE /api/platform/tiers/{} adminUserId={} tierId={} status=204",
          id,
          principal.getUserId(),
          id);
      return ResponseEntity.noContent().build();
    } catch (ResponseStatusException ex) {
      log.error(
          "DELETE /api/platform/tiers/{} adminUserId={} tierId={} status={} error={}",
          id,
          principal.getUserId(),
          id,
          ex.getStatusCode().value(),
          ex.getReason());
      throw ex;
    }
  }

  /** HU-46 AC-1: every global flag plus whether this tier includes it in its default package. */
  @GetMapping("/{id}/feature-flags")
  public List<TierFeatureFlagRowResponse> listFeatureFlags(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable("id") Long id) {
    requirePlatformAdmin(principal, "GET /api/platform/tiers/{id}/feature-flags");
    log.info(
        "GET /api/platform/tiers/{}/feature-flags adminUserId={} tierId={}",
        id,
        principal.getUserId(),
        id);
    try {
      List<TierFeatureFlagRowResponse> response = tierAdminService.listTierFeatureFlags(id);
      log.info(
          "GET /api/platform/tiers/{}/feature-flags adminUserId={} tierId={} status=200 count={}",
          id,
          principal.getUserId(),
          id,
          response.size());
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "GET /api/platform/tiers/{}/feature-flags adminUserId={} tierId={} status={} error={}",
          id,
          principal.getUserId(),
          id,
          ex.getStatusCode().value(),
          ex.getReason());
      throw ex;
    }
  }

  /**
   * HU-46 AC-1/AC-2: marks a flag as included (or not) in this tier's default package; AC-5:
   * records who made the change and when.
   */
  @PutMapping("/{id}/feature-flags/{flagKey}")
  public ResponseEntity<Void> setFeatureFlagIncluded(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("id") Long id,
      @PathVariable("flagKey") String flagKey,
      @Valid @RequestBody TierFeatureFlagIncludeRequest request) {
    requirePlatformAdmin(principal, "PUT /api/platform/tiers/{id}/feature-flags/{flagKey}");
    log.info(
        "PUT /api/platform/tiers/{}/feature-flags/{} adminUserId={} tierId={}",
        id,
        flagKey,
        principal.getUserId(),
        id);
    try {
      tierAdminService.setTierFeatureFlagIncluded(
          id, flagKey, request.included(), principal.getUserId(), principal.getUsername());
      log.info(
          "PUT /api/platform/tiers/{}/feature-flags/{} adminUserId={} tierId={} status=204",
          id,
          flagKey,
          principal.getUserId(),
          id);
      return ResponseEntity.noContent().build();
    } catch (ResponseStatusException ex) {
      log.error(
          "PUT /api/platform/tiers/{}/feature-flags/{} adminUserId={} tierId={} status={} error={}",
          id,
          flagKey,
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
