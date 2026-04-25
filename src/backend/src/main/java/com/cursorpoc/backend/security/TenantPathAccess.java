package com.cursorpoc.backend.security;

import com.cursorpoc.backend.domain.enums.UserRole;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * When a request path or parameter targets a specific tenant, it must match the tenant embedded in
 * the JWT, unless the caller is a {@link UserRole#SYSTEM_ADMIN}.
 */
public final class TenantPathAccess {

  private TenantPathAccess() {}

  /**
   * @throws ResponseStatusException FORBIDDEN when path tenant and JWT tenant do not match for
   *     non–system-admins
   */
  public static void requirePathTenantMatchesJwt(FemmeUserPrincipal principal, long pathTenantId) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    if (principal.getRole() == UserRole.SYSTEM_ADMIN) {
      return;
    }
    if (pathTenantId != principal.getTenantId()) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
  }
}
