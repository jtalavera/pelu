package com.cursorpoc.backend.security;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.cursorpoc.backend.domain.enums.UserRole;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

class TenantPathAccessTest {

  @Test
  void matches_whenSameTenant() {
    var p = new FemmeUserPrincipal(1L, 2L, "a@b.com", UserRole.ADMIN, null);
    TenantPathAccess.requirePathTenantMatchesJwt(p, 2L);
  }

  @Test
  void forbidden_whenDifferentTenants() {
    var p = new FemmeUserPrincipal(1L, 1L, "a@b.com", UserRole.ADMIN, null);
    assertThatThrownBy(() -> TenantPathAccess.requirePathTenantMatchesJwt(p, 2L))
        .isInstanceOf(ResponseStatusException.class)
        .hasFieldOrPropertyWithValue("statusCode", HttpStatus.FORBIDDEN);
  }

  /**
   * HU-34 AC-5 (and HU-36, which retired the legacy SYSTEM_ADMIN bypass this check used to have):
   * PLATFORM_ADMIN gets no bypass here — a tenant-less principal reaching this tenant-scoped check
   * at all is already a bug elsewhere (the JWT filter should have rejected it before any controller
   * ran), so this fails loudly instead of silently granting cross-tenant access.
   */
  @Test
  void platformAdmin_getsNoBypass_andFailsLoudlyInsteadOfGrantingAccess() {
    var p = new FemmeUserPrincipal(1L, null, "platform-admin@pelu", UserRole.PLATFORM_ADMIN, null);
    assertThatThrownBy(() -> TenantPathAccess.requirePathTenantMatchesJwt(p, 2L))
        .isInstanceOf(IllegalStateException.class);
  }
}
