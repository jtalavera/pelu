package com.cursorpoc.backend.booking;

import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.FeatureFlagService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Gate of the online booking (RT-01). The flag is {@code ONLINE_BOOKING}, OFF globally and enabled
 * per tier or tenant. Authenticated calls answer {@code 403 ONLINE_BOOKING_DISABLED} when it is
 * off; the PUBLIC routes never use {@link #requireEnabled}: they resolve the salon by slug and
 * answer the same neutral page as for an unknown slug (see {@link PublicBookingResolver}).
 */
@Component
public class BookingAccess {

  public static final String FLAG = "ONLINE_BOOKING";

  private final FeatureFlagService featureFlagService;

  public BookingAccess(FeatureFlagService featureFlagService) {
    this.featureFlagService = featureFlagService;
  }

  public boolean isEnabled(long tenantId) {
    return featureFlagService.isEnabled(FLAG, tenantId);
  }

  public void requireEnabled(FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    if (!principal.hasTenant() || principal.isPinSession()) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
    if (!isEnabled(principal.getTenantId())) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, FLAG + "_DISABLED");
    }
  }
}
