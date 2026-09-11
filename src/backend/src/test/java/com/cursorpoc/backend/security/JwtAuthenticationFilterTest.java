package com.cursorpoc.backend.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeJwtProperties;
import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.TenantStatus;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;

/**
 * HU-34 AC-3/AC-4, extended by HU-35 and HU-36: a PLATFORM_ADMIN token (no {@code tid})
 * authenticates on {@code /api/platform/**}, {@code /api/auth/**}, (since HU-35) {@code /api/me},
 * and (since HU-36) {@code /api/admin/feature-flags}, but is left unauthenticated everywhere else —
 * same outcome (SecurityContext left empty, so SecurityConfig's {@code
 * anyRequest().authenticated()} rejects the request) tenant-scoped routes already gave any tid-less
 * token before this story, for any role.
 *
 * <p>HU-40 AC-3: also covers the per-request tenant-status check — a tenant-scoped token stops
 * authenticating as soon as its tenant is {@code SUSPENDED}, and resumes authenticating as soon as
 * it's {@code ACTIVE} again, without a new token.
 *
 * <p>HU-43 AC-2/AC-4: also covers the per-request user-status check — a token stops authenticating
 * as soon as its own {@code AppUser} is deactivated (session invalidated on the next request), and
 * resumes authenticating as soon as it's reactivated, without a new token; deactivating one user
 * doesn't affect any other token.
 */
class JwtAuthenticationFilterTest {

  private JwtService jwtService;
  private TenantRepository tenantRepository;
  private AppUserRepository appUserRepository;
  private JwtAuthenticationFilter filter;

  @BeforeEach
  void setUp() {
    FemmeJwtProperties props = new FemmeJwtProperties();
    props.setSecret("unit-test-jwt-secret-min-32-characters-long!!");
    props.setAccessTokenTtlSeconds(28_800L);
    jwtService = new JwtService(props);
    tenantRepository = mock(TenantRepository.class);
    appUserRepository = mock(AppUserRepository.class);
    // Default: every tenant looked up is ACTIVE, unless a test overrides it below (HU-40 AC-3).
    Tenant activeTenant = new Tenant();
    activeTenant.setStatus(TenantStatus.ACTIVE);
    lenient().when(tenantRepository.findById(anyLong())).thenReturn(Optional.of(activeTenant));
    // Default: every user looked up is enabled, unless a test overrides it below (HU-43 AC-2/AC-4).
    AppUser enabledUser = new AppUser();
    enabledUser.setEnabled(true);
    lenient().when(appUserRepository.findById(anyLong())).thenReturn(Optional.of(enabledUser));
    filter = new JwtAuthenticationFilter(jwtService, tenantRepository, appUserRepository);
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
  void platformAdminToken_authenticates_onMeRoute() throws Exception {
    // HU-35: /api/me is generic "who am I", not tenant business data — the frontend's
    // /platform/** route guard needs it to resolve the current user's role, so a tenant-less
    // PLATFORM_ADMIN token must authenticate here (unlike genuinely tenant-scoped routes).
    runFilter(platformAdminToken(), "/api/me");

    var auth = SecurityContextHolder.getContext().getAuthentication();
    assertThat(auth).isNotNull();
    assertThat(((FemmeUserPrincipal) auth.getPrincipal()).isPlatformAdmin()).isTrue();
  }

  @Test
  void platformAdminToken_authenticates_onAdminFeatureFlagsRoute() throws Exception {
    // HU-36: the retired SYSTEM_ADMIN role used to reach these paths via a tenant-bound token plus
    // a TenantPathAccess bypass; PLATFORM_ADMIN reaches the very same paths as an explicit platform
    // route instead (see FeatureFlagController's requirePlatformAdmin gating).
    runFilter(platformAdminToken(), "/api/admin/feature-flags/tenants/1/sifen-homologation");

    var auth = SecurityContextHolder.getContext().getAuthentication();
    assertThat(auth).isNotNull();
    assertThat(((FemmeUserPrincipal) auth.getPrincipal()).isPlatformAdmin()).isTrue();
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

  // HU-40 AC-3: a tenant-scoped token stops authenticating the moment its tenant is SUSPENDED,
  // even though the JWT itself is still validly signed/unexpired.
  @Test
  void tenantToken_doesNotAuthenticate_whenTenantSuspended() throws Exception {
    Tenant suspended = new Tenant();
    suspended.setStatus(TenantStatus.SUSPENDED);
    when(tenantRepository.findById(7L)).thenReturn(Optional.of(suspended));

    String token =
        jwtService.createAccessToken(
            2L, 7L, "admin@tenant.test", UserRole.ADMIN, null, Instant.now());

    runFilter(token, "/api/clients");

    assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
  }

  // HU-40 AC-4: reactivating the tenant (status back to ACTIVE) immediately lets the very same
  // still-valid token authenticate again — no new login/token needed.
  @Test
  void tenantToken_authenticatesAgain_afterTenantReactivated() throws Exception {
    Tenant active = new Tenant();
    active.setStatus(TenantStatus.ACTIVE);
    when(tenantRepository.findById(7L)).thenReturn(Optional.of(active));

    String token =
        jwtService.createAccessToken(
            2L, 7L, "admin@tenant.test", UserRole.ADMIN, null, Instant.now());

    runFilter(token, "/api/clients");

    var auth = SecurityContextHolder.getContext().getAuthentication();
    assertThat(auth).isNotNull();
    assertThat(((FemmeUserPrincipal) auth.getPrincipal()).getTenantId()).isEqualTo(7L);
  }

  // HU-43 AC-2/AC-4: a token stops authenticating the moment its own AppUser is deactivated, even
  // though the JWT itself is still validly signed/unexpired — this is what invalidates an
  // already-open session on the very next request.
  @Test
  void tenantToken_doesNotAuthenticate_whenUserDisabled() throws Exception {
    AppUser disabled = new AppUser();
    disabled.setEnabled(false);
    when(appUserRepository.findById(2L)).thenReturn(Optional.of(disabled));

    String token =
        jwtService.createAccessToken(
            2L, 7L, "admin@tenant.test", UserRole.ADMIN, null, Instant.now());

    runFilter(token, "/api/clients");

    assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
  }

  // HU-43 AC-3: reactivating the user (enabled back to true) immediately lets the very same
  // still-valid token authenticate again — no new login/token needed.
  @Test
  void tenantToken_authenticatesAgain_afterUserReactivated() throws Exception {
    AppUser enabled = new AppUser();
    enabled.setEnabled(true);
    when(appUserRepository.findById(2L)).thenReturn(Optional.of(enabled));

    String token =
        jwtService.createAccessToken(
            2L, 7L, "admin@tenant.test", UserRole.ADMIN, null, Instant.now());

    runFilter(token, "/api/clients");

    var auth = SecurityContextHolder.getContext().getAuthentication();
    assertThat(auth).isNotNull();
    assertThat(((FemmeUserPrincipal) auth.getPrincipal()).getTenantId()).isEqualTo(7L);
  }

  // HU-43 AC-2: deactivating one user doesn't affect another user's token, even within the same
  // tenant.
  @Test
  void tenantToken_stillAuthenticates_forDifferentEnabledUser_whenAnotherUserDisabled()
      throws Exception {
    AppUser disabledOther = new AppUser();
    disabledOther.setEnabled(false);
    when(appUserRepository.findById(99L)).thenReturn(Optional.of(disabledOther));
    AppUser enabledSelf = new AppUser();
    enabledSelf.setEnabled(true);
    when(appUserRepository.findById(2L)).thenReturn(Optional.of(enabledSelf));

    String token =
        jwtService.createAccessToken(
            2L, 7L, "admin@tenant.test", UserRole.ADMIN, null, Instant.now());

    runFilter(token, "/api/clients");

    assertThat(SecurityContextHolder.getContext().getAuthentication()).isNotNull();
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
