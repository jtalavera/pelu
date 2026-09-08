package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeJwtProperties;
import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.TenantStatus;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.AppUserActivationTokenRepository;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.PasswordResetTokenRepository;
import com.cursorpoc.backend.repository.ProfessionalActivationTokenRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.security.JwtService;
import com.cursorpoc.backend.web.dto.LoginRequest;
import com.cursorpoc.backend.web.dto.TokenResponse;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-40 AC-2: a SUSPENDED tenant blocks login for every one of its users, with a response
 * byte-for-byte identical to "bad credentials" — same HTTP status, same error code — so an
 * enumeration attempt can't distinguish a suspended tenant from a wrong email/password. Tenant
 * resolution: when no Origin/domain match exists, login() gathers every AppUser for the email
 * across tenants and lets password verification (not a guessed tenant) decide which one is real —
 * see AuthService#candidateUsersForLogin.
 */
@ExtendWith(MockitoExtension.class)
class AuthServiceTest {

  @Mock private AppUserRepository appUserRepository;
  @Mock private PasswordResetTokenRepository passwordResetTokenRepository;
  @Mock private ProfessionalActivationTokenRepository activationTokenRepository;
  @Mock private AppUserActivationTokenRepository appUserActivationTokenRepository;
  @Mock private ProfessionalRepository professionalRepository;
  @Mock private TenantRepository tenantRepository;
  @Mock private PasswordEncoder passwordEncoder;

  private AuthService service;

  @BeforeEach
  void setUp() {
    FemmeJwtProperties jwtProperties = new FemmeJwtProperties();
    jwtProperties.setSecret("unit-test-jwt-secret-min-32-characters-long!!");
    jwtProperties.setAccessTokenTtlSeconds(28_800L);
    JwtService jwtService = new JwtService(jwtProperties);
    EmailService emailService = mock(EmailService.class);

    service =
        new AuthService(
            appUserRepository,
            passwordResetTokenRepository,
            activationTokenRepository,
            appUserActivationTokenRepository,
            professionalRepository,
            tenantRepository,
            passwordEncoder,
            jwtService,
            jwtProperties,
            emailService);

    // findAllByEmail (the tenant-independent PLATFORM_ADMIN fast-path, plus the email-based
    // fallback below) defaults to "nobody" unless a test stubs it — Mockito already returns an
    // empty List for unstubbed List-returning methods, this just documents that explicitly.
    lenient()
        .when(appUserRepository.findAllByEmail(org.mockito.ArgumentMatchers.anyString()))
        .thenReturn(List.of());
    // No domain is set up in these tests (a bare local/test Origin) — candidateUsersForLogin()
    // always falls through to the email-based fallback below.
    lenient()
        .when(tenantRepository.findByDomain(org.mockito.ArgumentMatchers.anyString()))
        .thenReturn(Optional.empty());
  }

  private Tenant tenant(long id, TenantStatus status) {
    Tenant t = new Tenant();
    t.setId(id);
    t.setName("Salon");
    t.setStatus(status);
    return t;
  }

  private AppUser user(Tenant tenant, String email, String passwordHash) {
    AppUser u = new AppUser();
    u.setId(5L);
    u.setTenant(tenant);
    u.setEmail(email);
    u.setRole(UserRole.ADMIN);
    u.setPasswordHash(passwordHash);
    u.setEnabled(true);
    return u;
  }

  @Test
  void suspendedTenant_rejectsLogin_withSameErrorAsBadCredentials() {
    Tenant tenant = tenant(1L, TenantStatus.SUSPENDED);
    AppUser appUser = user(tenant, "admin@tenant.test", "hashed");
    when(appUserRepository.findAllByEmail("admin@tenant.test")).thenReturn(List.of(appUser));
    lenient().when(passwordEncoder.matches("whatever-password", "hashed")).thenReturn(true);

    ResponseStatusException suspendedEx =
        catchLoginException(new LoginRequest("admin@tenant.test", "whatever-password"));
    ResponseStatusException wrongPasswordEx =
        catchLoginException(new LoginRequest("nonexistent@tenant.test", "whatever-password"));

    assertThat(suspendedEx.getStatusCode()).isEqualTo(wrongPasswordEx.getStatusCode());
    assertThat(suspendedEx.getReason()).isEqualTo(wrongPasswordEx.getReason());
    assertThat(suspendedEx.getReason()).isEqualTo("INVALID_CREDENTIALS");
  }

  @Test
  void activeTenant_allowsLogin_withCorrectCredentials() {
    Tenant tenant = tenant(1L, TenantStatus.ACTIVE);
    AppUser appUser = user(tenant, "admin@tenant.test", "hashed");
    when(appUserRepository.findAllByEmail("admin@tenant.test")).thenReturn(List.of(appUser));
    when(passwordEncoder.matches("correct-password", "hashed")).thenReturn(true);

    TokenResponse response =
        service.login(new LoginRequest("admin@tenant.test", "correct-password"), null);

    assertThat(response.accessToken()).isNotBlank();
  }

  @Test
  void reactivatedTenant_allowsLoginAgain() {
    Tenant tenant = tenant(1L, TenantStatus.ACTIVE);
    AppUser appUser = user(tenant, "admin@tenant.test", "hashed");
    when(appUserRepository.findAllByEmail("admin@tenant.test")).thenReturn(List.of(appUser));
    when(passwordEncoder.matches("correct-password", "hashed")).thenReturn(true);

    // Simulate: suspend then reactivate — by the time login() runs, status is ACTIVE again.
    tenant.setStatus(TenantStatus.SUSPENDED);
    tenant.setStatus(TenantStatus.ACTIVE);

    TokenResponse response =
        service.login(new LoginRequest("admin@tenant.test", "correct-password"), null);

    assertThat(response.accessToken()).isNotBlank();
  }

  @Test
  void emailNotLinkedToAnyTenant_rejectsLogin_withInvalidCredentials() {
    ResponseStatusException ex =
        catchLoginException(new LoginRequest("nobody@nowhere.test", "whatever-password"));

    assertThat(ex.getStatusCode().value()).isEqualTo(401);
    assertThat(ex.getReason()).isEqualTo("INVALID_CREDENTIALS");
  }

  @Test
  void emailMatchesTwoTenants_onlyOneWithValidPassword_logsInToThatTenant() {
    Tenant tenantA = tenant(1L, TenantStatus.ACTIVE);
    Tenant tenantB = tenant(2L, TenantStatus.ACTIVE);
    AppUser userA = user(tenantA, "shared@tenant.test", "hashA");
    AppUser userB = user(tenantB, "shared@tenant.test", "hashB");
    when(appUserRepository.findAllByEmail("shared@tenant.test")).thenReturn(List.of(userA, userB));
    when(passwordEncoder.matches("correct-password", "hashA")).thenReturn(true);
    when(passwordEncoder.matches("correct-password", "hashB")).thenReturn(false);

    TokenResponse response =
        service.login(new LoginRequest("shared@tenant.test", "correct-password"), null);

    assertThat(response.accessToken()).isNotBlank();
  }

  @Test
  void emailMatchesTwoTenantsWithValidPasswordInBoth_rejectsLogin_withTenantAmbiguous() {
    Tenant tenantA = tenant(1L, TenantStatus.ACTIVE);
    Tenant tenantB = tenant(2L, TenantStatus.ACTIVE);
    AppUser userA = user(tenantA, "shared@tenant.test", "sameHash");
    AppUser userB = user(tenantB, "shared@tenant.test", "sameHash");
    when(appUserRepository.findAllByEmail("shared@tenant.test")).thenReturn(List.of(userA, userB));
    when(passwordEncoder.matches("correct-password", "sameHash")).thenReturn(true);

    ResponseStatusException ex =
        catchLoginException(new LoginRequest("shared@tenant.test", "correct-password"));

    assertThat(ex.getStatusCode().value()).isEqualTo(401);
    assertThat(ex.getReason()).isEqualTo("TENANT_AMBIGUOUS");
  }

  private ResponseStatusException catchLoginException(LoginRequest request) {
    try {
      service.login(request, null);
    } catch (ResponseStatusException ex) {
      return ex;
    }
    throw new AssertionError("expected login() to throw ResponseStatusException");
  }
}
