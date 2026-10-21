package com.cursorpoc.backend.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeJwtProperties;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.SharedDevice;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.TenantStatus;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.SharedDeviceRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.access.intercept.RequestAuthorizationContext;

/**
 * HU-66: a PIN session (professional who entered her PIN on a shared device) is calendar-only and
 * works only on the device that issued it, while the device is enabled and her PIN unchanged.
 */
class PinSessionSecurityTest {

  private static final long TENANT = 7L;
  private static final long PRO = 9L;
  private static final long DEVICE = 3L;
  private static final String DEVICE_TOKEN = "device-raw-token";

  private JwtService jwtService;
  private ProfessionalRepository professionalRepository;
  private SharedDeviceRepository deviceRepository;
  private JwtAuthenticationFilter filter;
  private SharedDevice device;
  private Professional professional;

  @BeforeEach
  void setUp() {
    FemmeJwtProperties props = new FemmeJwtProperties();
    props.setSecret("unit-test-jwt-secret-min-32-characters-long!!");
    props.setAccessTokenTtlSeconds(28_800L);
    jwtService = new JwtService(props);
    TenantRepository tenantRepository = mock(TenantRepository.class);
    Tenant tenant = new Tenant();
    tenant.setId(TENANT);
    tenant.setStatus(TenantStatus.ACTIVE);
    lenient().when(tenantRepository.findById(anyLong())).thenReturn(Optional.of(tenant));
    AppUserRepository appUserRepository = mock(AppUserRepository.class);
    lenient().when(appUserRepository.findById(anyLong())).thenReturn(Optional.empty());
    professionalRepository = mock(ProfessionalRepository.class);
    deviceRepository = mock(SharedDeviceRepository.class);

    device = new SharedDevice();
    device.setId(DEVICE);
    device.setTenant(tenant);
    lenient()
        .when(deviceRepository.findByTokenHash(DeviceTokens.hash(DEVICE_TOKEN)))
        .thenReturn(Optional.of(device));
    professional = new Professional();
    professional.setId(PRO);
    professional.setActive(true);
    professional.setPinFingerprint("fp");
    professional.setPinVersion(2);
    lenient()
        .when(professionalRepository.findByIdAndTenant_Id(PRO, TENANT))
        .thenReturn(Optional.of(professional));
    lenient().when(professionalRepository.findById(PRO)).thenReturn(Optional.of(professional));
    filter =
        new JwtAuthenticationFilter(
            jwtService,
            tenantRepository,
            appUserRepository,
            professionalRepository,
            deviceRepository);
  }

  @AfterEach
  void tearDown() {
    SecurityContextHolder.clearContext();
  }

  private String pinToken(int version) {
    return jwtService.createPinSessionToken(
        FemmeUserPrincipal.pinSession(TENANT, PRO, DEVICE, version), Instant.now());
  }

  private Authentication run(String token, String deviceToken) throws Exception {
    MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api/appointments");
    req.setRequestURI("/api/appointments");
    req.addHeader("Authorization", "Bearer " + token);
    if (deviceToken != null) {
      req.addHeader(DeviceTokens.HEADER, deviceToken);
    }
    filter.doFilter(req, new MockHttpServletResponse(), new MockFilterChain());
    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
    SecurityContextHolder.clearContext();
    return auth;
  }

  @Test
  void pinSession_authenticatesOnTheIssuingDevice() throws Exception {
    Authentication auth = run(pinToken(2), DEVICE_TOKEN);
    assertThat(auth).isNotNull();
    FemmeUserPrincipal p = (FemmeUserPrincipal) auth.getPrincipal();
    assertThat(p.isPinSession()).isTrue();
    assertThat(p.getPinDeviceId()).isEqualTo(DEVICE);
  }

  @Test
  void pinSession_isRejectedWithoutTheDeviceOrFromAnotherDevice() throws Exception {
    assertThat(run(pinToken(2), null)).isNull();
    assertThat(run(pinToken(2), "another-device")).isNull();
  }

  @Test
  void pinSession_isRejectedOnceTheDeviceIsRevoked() throws Exception {
    device.setRevokedAt(Instant.now());
    assertThat(run(pinToken(2), DEVICE_TOKEN)).isNull();
  }

  @Test
  void pinSession_isRejectedWhenThePinChangedOrWasCleared_orTheProfessionalIsInactive()
      throws Exception {
    assertThat(run(pinToken(1), DEVICE_TOKEN)).isNull(); // PIN changed since
    professional.setPinFingerprint(null);
    assertThat(run(pinToken(2), DEVICE_TOKEN)).isNull(); // PIN cleared
    professional.setPinFingerprint("fp");
    professional.setActive(false);
    assertThat(run(pinToken(2), DEVICE_TOKEN)).isNull(); // deactivated
  }

  @Test
  void filterWithoutDeviceSupport_neverAcceptsPinSessions() throws Exception {
    TenantRepository tenants = mock(TenantRepository.class);
    when(tenants.findById(anyLong())).thenReturn(Optional.empty());
    JwtAuthenticationFilter legacy =
        new JwtAuthenticationFilter(
            jwtService, tenants, mock(AppUserRepository.class), professionalRepository);
    MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api/appointments");
    req.setRequestURI("/api/appointments");
    req.addHeader("Authorization", "Bearer " + pinToken(2));
    req.addHeader(DeviceTokens.HEADER, DEVICE_TOKEN);
    legacy.doFilter(req, new MockHttpServletResponse(), new MockFilterChain());
    assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
  }

  // ── Calendar-only policy ────────────────────────────────────────────────────────────────────

  private boolean allowed(String method, String uri) {
    MockHttpServletRequest request = new MockHttpServletRequest(method, uri);
    request.setRequestURI(uri);
    FemmeUserPrincipal p = FemmeUserPrincipal.pinSession(TENANT, PRO, DEVICE, 2);
    Authentication auth = new UsernamePasswordAuthenticationToken(p, null, p.getAuthorities());
    return new ProfessionalAccessPolicy()
        .authorize(() -> auth, new RequestAuthorizationContext(request))
        .isGranted();
  }

  @ParameterizedTest
  @CsvSource({
    "GET, /api/me",
    "GET, /api/feature-flags",
    "GET, /api/appointments",
    "GET, /api/appointments/4",
    "POST, /api/appointments",
    "PUT, /api/appointments/4",
    "PATCH, /api/appointments/4/status",
    "GET, /api/professionals",
    "GET, /api/services",
    "GET, /api/clients",
  })
  void pinSession_reachesTheCalendar(String method, String uri) {
    assertThat(allowed(method, uri)).isTrue();
  }

  @ParameterizedTest
  @CsvSource({
    "GET, /api/commissions/me",
    "GET, /api/commissions/me/settlements/1",
    "PUT, /api/me/profile",
    "POST, /api/me/change-password",
    "GET, /api/me/tour-state",
    "POST, /api/me/tour-state/calendar",
    "GET, /api/invoices",
    "POST, /api/professionals/9/unlock-pin",
    "GET, /api/shared-devices",
  })
  void pinSession_isDeniedEverythingElse(String method, String uri) {
    assertThat(allowed(method, uri)).isFalse();
  }
}
