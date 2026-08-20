package com.cursorpoc.backend.security;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.config.FemmeJwtProperties;
import com.cursorpoc.backend.domain.enums.UserRole;
import java.time.Instant;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;

/**
 * HU-34 AC-3/AC-4: a PLATFORM_ADMIN token (no {@code tid}) authenticates on {@code
 * /api/platform/**} and {@code /api/auth/**}, but is left unauthenticated everywhere else — same
 * outcome (SecurityContext left empty, so SecurityConfig's {@code anyRequest().authenticated()}
 * rejects the request) tenant-scoped routes already gave any tid-less token before this story, for
 * any role.
 */
class JwtAuthenticationFilterTest {

  private JwtService jwtService;
  private JwtAuthenticationFilter filter;

  @BeforeEach
  void setUp() {
    FemmeJwtProperties props = new FemmeJwtProperties();
    props.setSecret("unit-test-jwt-secret-min-32-characters-long!!");
    props.setAccessTokenTtlSeconds(28_800L);
    jwtService = new JwtService(props);
    filter = new JwtAuthenticationFilter(jwtService);
  }

  @AfterEach
  void tearDown() {
    SecurityContextHolder.clearContext();
  }

  @Test
  void platformAdminToken_authenticates_onPlatformRoute() throws Exception {
    runFilter(platformAdminToken(), "/api/platform/me");

    var auth = SecurityContextHolder.getContext().getAuthentication();
    assertThat(auth).isNotNull();
    assertThat(((FemmeUserPrincipal) auth.getPrincipal()).isPlatformAdmin()).isTrue();
  }

  @Test
  void platformAdminToken_authenticates_onAuthRoute() throws Exception {
    runFilter(platformAdminToken(), "/api/auth/refresh");

    assertThat(SecurityContextHolder.getContext().getAuthentication()).isNotNull();
  }

  @Test
  void platformAdminToken_doesNotAuthenticate_onTenantScopedRoute() throws Exception {
    runFilter(platformAdminToken(), "/api/clients");

    assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
  }

  @Test
  void platformAdminToken_doesNotAuthenticate_onMeRoute() throws Exception {
    // /api/me is generic "who am I", not under /api/platform/** — HU-34 deliberately leaves it
    // out of scope (HU-35 wires platform-admin support into it); a tenant-less token must not
    // silently authenticate there either.
    runFilter(platformAdminToken(), "/api/me");

    assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
  }

  @Test
  void adminToken_stillAuthenticates_onTenantScopedRoute() throws Exception {
    String token =
        jwtService.createAccessToken(
            2L, 7L, "admin@tenant.test", UserRole.ADMIN, null, Instant.now());

    runFilter(token, "/api/clients");

    var auth = SecurityContextHolder.getContext().getAuthentication();
    assertThat(auth).isNotNull();
    assertThat(((FemmeUserPrincipal) auth.getPrincipal()).getTenantId()).isEqualTo(7L);
  }

  private String platformAdminToken() {
    return jwtService.createAccessToken(
        1L, null, "platform-admin@pelu", UserRole.PLATFORM_ADMIN, null, Instant.now());
  }

  private void runFilter(String token, String requestUri) throws Exception {
    MockHttpServletRequest request = new MockHttpServletRequest();
    request.setRequestURI(requestUri);
    request.addHeader("Authorization", "Bearer " + token);
    MockHttpServletResponse response = new MockHttpServletResponse();
    filter.doFilter(request, response, new MockFilterChain());
  }
}
