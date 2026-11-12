package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeJwtProperties;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.TenantStatus;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.security.JwtService;
import com.cursorpoc.backend.web.dto.TokenResponse;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Issue #310: the Platform Admin impersonates a tenant's administrator. */
@ExtendWith(MockitoExtension.class)
class PlatformImpersonationServiceTest {

  @Mock private TenantRepository tenantRepository;

  private JwtService jwtService;
  private PlatformImpersonationService service;

  private final FemmeUserPrincipal root =
      new FemmeUserPrincipal(1L, null, "root@pelu", UserRole.PLATFORM_ADMIN, null);

  @BeforeEach
  void setUp() {
    FemmeJwtProperties props = new FemmeJwtProperties();
    props.setSecret("unit-test-jwt-secret-min-32-characters-long!!");
    props.setAccessTokenTtlSeconds(3_600L);
    jwtService = new JwtService(props);
    service = new PlatformImpersonationService(tenantRepository, jwtService, props);
  }

  private static Tenant tenant(long id, TenantStatus status) {
    Tenant t = new Tenant();
    t.setId(id);
    t.setName("Salon " + id);
    t.setStatus(status);
    return t;
  }

  @Test
  void issuesATenantAdminTokenAttributedToTheRootUser() {
    when(tenantRepository.findById(7L)).thenReturn(Optional.of(tenant(7L, TenantStatus.ACTIVE)));

    TokenResponse response = service.impersonateTenantAdmin(root, 7L);

    assertThat(response.tokenType()).isEqualTo("Bearer");
    assertThat(response.expiresInSeconds()).isEqualTo(3_600L);
    FemmeUserPrincipal p = jwtService.parseAndValidate(response.accessToken()).orElseThrow();
    assertThat(p.getTenantId()).isEqualTo(7L);
    assertThat(p.getRole()).isEqualTo(UserRole.ADMIN);
    assertThat(p.isAdmin()).isTrue();
    assertThat(p.isPlatformAdmin()).isFalse();
    assertThat(p.isImpersonation()).isTrue();
    assertThat(p.getUserId()).isEqualTo(1L);
    assertThat(p.getUsername()).isEqualTo("root@pelu");
    assertThat(p.getProfessionalId()).isNull();
  }

  @Test
  void unknownTenant_isNotFound() {
    when(tenantRepository.findById(99L)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.impersonateTenantAdmin(root, 99L))
        .isInstanceOfSatisfying(
            ResponseStatusException.class,
            ex -> {
              assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
              assertThat(ex.getReason()).isEqualTo("TENANT_NOT_FOUND");
            });
  }

  @Test
  void suspendedTenant_isRejected() {
    when(tenantRepository.findById(7L)).thenReturn(Optional.of(tenant(7L, TenantStatus.SUSPENDED)));

    assertThatThrownBy(() -> service.impersonateTenantAdmin(root, 7L))
        .isInstanceOfSatisfying(
            ResponseStatusException.class,
            ex -> {
              assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
              assertThat(ex.getReason()).isEqualTo("TENANT_SUSPENDED");
            });
  }
}
