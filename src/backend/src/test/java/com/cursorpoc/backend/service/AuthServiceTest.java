package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeJwtProperties;
import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.TenantStatus;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.PasswordResetTokenRepository;
import com.cursorpoc.backend.repository.ProfessionalActivationTokenRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.security.JwtService;
import com.cursorpoc.backend.web.dto.LoginRequest;
import com.cursorpoc.backend.web.dto.TokenResponse;
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
 * enumeration attempt can't distinguish a suspended tenant from a wrong email/password.
 */
@ExtendWith(MockitoExtension.class)
class AuthServiceTest {

  @Mock private AppUserRepository appUserRepository;
  @Mock private PasswordResetTokenRepository passwordResetTokenRepository;
  @Mock private ProfessionalActivationTokenRepository activationTokenRepository;
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
            professionalRepository,
            tenantRepository,
            passwordEncoder,
            jwtService,
            jwtProperties,
            emailService);

    // findByEmail (the tenant-independent PLATFORM_ADMIN fast-path) never matches a tenant-bound
    // email in these tests, so login() always falls through to the tenant-scoped path below.
    lenient()
        .when(appUserRepository.findByEmail(org.mockito.ArgumentMatchers.anyString()))
        .thenReturn(Optional.empty());
    // resolveTenant(origin) falls back to tenant id=1 when the Origin header doesn't match any
    // tenant's domain (no domain is set up in these tests, exactly like a bare local/test origin).
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
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));

    ResponseStatusException suspendedEx =
        catchLoginException(new LoginRequest("admin@tenant.test", "whatever-password"));
    ResponseStatusException wrongPasswordEx =
        catchLoginException(new LoginRequest("nonexistent@tenant.test", "whatever-password"));

    assertThat(suspendedEx.getStatusCode()).isEqualTo(wrongPasswordEx.getStatusCode());
    assertThat(suspendedEx.getReason()).isEqualTo(wrongPasswordEx.getReason());
    assertThat(suspendedEx.getReason()).isEqualTo("INVALID_CREDENTIALS");

    // The suspended-tenant path must short-circuit before ever touching the user lookup — proof
    // that the check can't be used to enumerate which emails exist in a suspended tenant either.
    verify(appUserRepository, never()).findByEmailAndTenant_Id(any(), any());
  }

  @Test
  void activeTenant_allowsLogin_withCorrectCredentials() {
    Tenant tenant = tenant(1L, TenantStatus.ACTIVE);
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    AppUser appUser = user(tenant, "admin@tenant.test", "hashed");
    when(appUserRepository.findByEmailAndTenant_Id("admin@tenant.test", 1L))
        .thenReturn(Optional.of(appUser));
    when(passwordEncoder.matches("correct-password", "hashed")).thenReturn(true);

    TokenResponse response =
        service.login(new LoginRequest("admin@tenant.test", "correct-password"), null);

    assertThat(response.accessToken()).isNotBlank();
  }

  @Test
  void reactivatedTenant_allowsLoginAgain() {
    Tenant tenant = tenant(1L, TenantStatus.ACTIVE);
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    AppUser appUser = user(tenant, "admin@tenant.test", "hashed");
    when(appUserRepository.findByEmailAndTenant_Id("admin@tenant.test", 1L))
        .thenReturn(Optional.of(appUser));
    when(passwordEncoder.matches("correct-password", "hashed")).thenReturn(true);

    // Simulate: suspend then reactivate — by the time login() runs, status is ACTIVE again.
    tenant.setStatus(TenantStatus.SUSPENDED);
    tenant.setStatus(TenantStatus.ACTIVE);

    TokenResponse response =
        service.login(new LoginRequest("admin@tenant.test", "correct-password"), null);

    assertThat(response.accessToken()).isNotBlank();
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
