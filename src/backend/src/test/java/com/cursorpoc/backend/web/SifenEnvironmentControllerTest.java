package com.cursorpoc.backend.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.cursorpoc.backend.config.SifenConnectionProperties;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class SifenEnvironmentControllerTest {

  private static final FemmeUserPrincipal PRINCIPAL =
      new FemmeUserPrincipal(7L, 1L, "demo@example.com", UserRole.ADMIN, null);

  @Test
  void get_returnsTheActiveEnvironment() {
    SifenConnectionProperties props = new SifenConnectionProperties();
    props.setEnvironment(SifenConnectionProperties.Environment.TEST);

    assertThat(new SifenEnvironmentController(props).get(PRINCIPAL).environment())
        .isEqualTo("TEST");

    props.setEnvironment(SifenConnectionProperties.Environment.PRODUCTION);
    assertThat(new SifenEnvironmentController(props).get(PRINCIPAL).environment())
        .isEqualTo("PRODUCTION");
  }

  @Test
  void get_withoutPrincipal_isUnauthorized() {
    assertThatThrownBy(
            () -> new SifenEnvironmentController(new SifenConnectionProperties()).get(null))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("UNAUTHORIZED");
  }
}
