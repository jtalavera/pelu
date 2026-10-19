package com.cursorpoc.backend.commission;

import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.FeatureFlagService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** HU-COM-11 + permissions (§3): flag gate, ADMIN-only and own-data-only checks. */
@Component
public class CommissionAccess {

  public static final String FLAG = "COMMISSIONS";

  private final FeatureFlagService featureFlagService;

  public CommissionAccess(FeatureFlagService featureFlagService) {
    this.featureFlagService = featureFlagService;
  }

  public boolean isEnabled(long tenantId) {
    return featureFlagService.isEnabled(FLAG, tenantId);
  }

  public void requireEnabled(FemmeUserPrincipal principal) {
    requireTenant(principal);
    if (!isEnabled(principal.getTenantId())) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FEATURE_NOT_ENABLED");
    }
  }

  public void requireAdmin(FemmeUserPrincipal principal) {
    requireEnabled(principal);
    if (!principal.isAdmin()) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
  }

  /** Returns the professional id of a logged PROFESSIONAL (own view, HU-COM-07). */
  public long requireProfessional(FemmeUserPrincipal principal) {
    requireEnabled(principal);
    if (!principal.isProfessional() || principal.getProfessionalId() == null) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
    return principal.getProfessionalId();
  }

  private static void requireTenant(FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    if (!principal.hasTenant()) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
  }
}
