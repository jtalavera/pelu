package com.cursorpoc.backend.security;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * When a request path or parameter targets a specific tenant, it must match the tenant embedded in
 * the JWT. There is no bypass for any role: {@code PLATFORM_ADMIN} reaches tenant data only through
 * routes designed for it explicitly (e.g. {@code /api/platform/**}, {@code
 * /api/admin/feature-flags/**}), which never call this check — see {@link
 * com.cursorpoc.backend.web.FeatureFlagController}. HU-36 retired the legacy {@code SYSTEM_ADMIN}
 * bypass that used to live here.
 */
public final class TenantPathAccess {

  private TenantPathAccess() {}

  /**
   * @throws ResponseStatusException FORBIDDEN when path tenant and JWT tenant do not match
   */
  public static void requirePathTenantMatchesJwt(FemmeUserPrincipal principal, long pathTenantId) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    if (pathTenantId != principal.getTenantId()) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
  }
}
