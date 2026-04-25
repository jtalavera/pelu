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
  void systemAdmin_skipsPathCheck() {
    var p = new FemmeUserPrincipal(1L, 99L, "root@pelu", UserRole.SYSTEM_ADMIN, null);
    TenantPathAccess.requirePathTenantMatchesJwt(p, 2L);
  }

  @Test
  void forbidden_whenDifferentTenants() {
    var p = new FemmeUserPrincipal(1L, 1L, "a@b.com", UserRole.ADMIN, null);
    assertThatThrownBy(() -> TenantPathAccess.requirePathTenantMatchesJwt(p, 2L))
        .isInstanceOf(ResponseStatusException.class)
        .hasFieldOrPropertyWithValue("statusCode", HttpStatus.FORBIDDEN);
  }
}
