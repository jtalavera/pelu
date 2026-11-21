package com.cursorpoc.backend.assistant;

import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.FeatureFlagService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** Gate of every {@code /api/assistant/**} call: authenticated, with a tenant, flag on. */
@Component
public class AssistantAccess {

  public static final String FLAG = "ASSISTANT_CHATBOT";

  private final FeatureFlagService featureFlagService;

  public AssistantAccess(FeatureFlagService featureFlagService) {
    this.featureFlagService = featureFlagService;
  }

  public boolean isEnabled(long tenantId) {
    return featureFlagService.isEnabled(FLAG, tenantId);
  }

  public void requireEnabled(FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    // A PIN session on a shared device is calendar-only and has no real user row (userId 0).
    if (!principal.hasTenant() || principal.isPinSession()) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
    if (!isEnabled(principal.getTenantId())) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "ASSISTANT_DISABLED");
    }
  }
}
