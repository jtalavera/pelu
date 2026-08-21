package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;

import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.Tier;
import com.cursorpoc.backend.domain.enums.TenantStatus;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.repository.TierRepository;
import com.cursorpoc.backend.web.dto.TenantCreateRequest;
import com.cursorpoc.backend.web.dto.TenantResponse;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-37 (crear tenant): AC-2 (empty name rejected), AC-3 (duplicate domain rejected, empty domain
 * allowed), AC-4 (created ACTIVE), and the tier-required/tier-must-exist rule from AC-1.
 */
@ExtendWith(MockitoExtension.class)
class TenantAdminServiceTest {

  @Mock private TenantRepository tenantRepository;
  @Mock private TierRepository tierRepository;

  @InjectMocks private TenantAdminService service;

  private Tier tier;
  private final AtomicLong ids = new AtomicLong(1);

  @BeforeEach
  void setUp() {
    tier = new Tier();
    tier.setId(1L);
    tier.setName("Estándar");
    lenient().when(tierRepository.findById(1L)).thenReturn(Optional.of(tier));

    lenient()
        .when(tenantRepository.save(any(Tenant.class)))
        .thenAnswer(
            inv -> {
              Tenant t = inv.getArgument(0);
              if (t.getId() == null) {
                t.setId(ids.getAndIncrement());
              }
              return t;
            });
  }

  @Test
  void createsActiveTenantWithNameDomainAndTier() {
    lenient()
        .when(tenantRepository.findByDomain("bellavista.pelu.app"))
        .thenReturn(Optional.empty());

    TenantResponse response =
        service.create(new TenantCreateRequest("Salon Bella Vista", "bellavista.pelu.app", 1L));

    assertThat(response.name()).isEqualTo("Salon Bella Vista");
    assertThat(response.domain()).isEqualTo("bellavista.pelu.app");
    assertThat(response.tierId()).isEqualTo(1L);
    assertThat(response.tierName()).isEqualTo("Estándar");
    assertThat(response.status()).isEqualTo(TenantStatus.ACTIVE.name());
  }

  @Test
  void allowsBlankDomain() {
    TenantResponse response =
        service.create(new TenantCreateRequest("Salon Sin Dominio", "  ", 1L));

    assertThat(response.domain()).isNull();
  }

  @Test
  void rejectsBlankName() {
    assertThatThrownBy(() -> service.create(new TenantCreateRequest("   ", null, 1L)))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("TENANT_NAME_REQUIRED");
  }

  @Test
  void rejectsDuplicateDomain() {
    Tenant existing = new Tenant();
    existing.setId(9L);
    existing.setName("Otro salón");
    existing.setDomain("bellavista.pelu.app");
    lenient()
        .when(tenantRepository.findByDomain("bellavista.pelu.app"))
        .thenReturn(Optional.of(existing));

    assertThatThrownBy(
            () ->
                service.create(
                    new TenantCreateRequest("Salon Bella Vista", "bellavista.pelu.app", 1L)))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("TENANT_DOMAIN_DUPLICATE");
  }

  @Test
  void rejectsMissingTier() {
    assertThatThrownBy(
            () -> service.create(new TenantCreateRequest("Salon Bella Vista", null, null)))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("TENANT_TIER_REQUIRED");
  }

  @Test
  void rejectsUnknownTier() {
    lenient().when(tierRepository.findById(99L)).thenReturn(Optional.empty());

    assertThatThrownBy(
            () -> service.create(new TenantCreateRequest("Salon Bella Vista", null, 99L)))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("TIER_NOT_FOUND");
  }
}
