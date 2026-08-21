package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.TenantTierChange;
import com.cursorpoc.backend.domain.Tier;
import com.cursorpoc.backend.domain.enums.TenantStatus;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.repository.TenantTierChangeRepository;
import com.cursorpoc.backend.repository.TierRepository;
import com.cursorpoc.backend.web.dto.TenantCreateRequest;
import com.cursorpoc.backend.web.dto.TenantResponse;
import com.cursorpoc.backend.web.dto.TenantUpdateRequest;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.Mockito;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-37 (crear tenant): AC-2 (empty name rejected), AC-3 (duplicate domain rejected, empty domain
 * allowed), AC-4 (created ACTIVE), and the tier-required/tier-must-exist rule from AC-1.
 *
 * <p>HU-38 (editar tenant): AC-1/AC-2 (same validations on edit, domain uniqueness excludes self),
 * AC-3/AC-4 (tier change persisted without touching flag overrides — there's nothing here to clear,
 * this service never touches {@code tenant_feature_flags}), AC-6 (tier change audited via {@link
 * TenantTierChange}).
 */
@ExtendWith(MockitoExtension.class)
class TenantAdminServiceTest {

  @Mock private TenantRepository tenantRepository;
  @Mock private TierRepository tierRepository;
  @Mock private TenantTierChangeRepository tenantTierChangeRepository;

  private TenantAdminService service;

  private Tier tier;
  private Tier otherTier;
  private final AtomicLong ids = new AtomicLong(1);

  @BeforeEach
  void setUp() {
    service =
        new TenantAdminService(
            tenantRepository,
            tierRepository,
            tenantTierChangeRepository,
            new FemmeTimeProperties());

    tier = new Tier();
    tier.setId(1L);
    tier.setName("Estándar");
    otherTier = new Tier();
    otherTier.setId(2L);
    otherTier.setName("Premium");
    lenient().when(tierRepository.findById(1L)).thenReturn(Optional.of(tier));
    lenient().when(tierRepository.findById(2L)).thenReturn(Optional.of(otherTier));

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
    lenient()
        .when(tenantTierChangeRepository.findByTenantId(Mockito.anyLong()))
        .thenReturn(Optional.empty());
    lenient()
        .when(tenantTierChangeRepository.save(any(TenantTierChange.class)))
        .thenAnswer(inv -> inv.getArgument(0));
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

  private Tenant existingTenant(Long id, String name, String domain, Tier withTier) {
    Tenant t = new Tenant();
    t.setId(id);
    t.setName(name);
    t.setDomain(domain);
    t.setTier(withTier);
    t.setStatus(TenantStatus.ACTIVE);
    return t;
  }

  // HU-38 AC-1/AC-3/AC-6: edits name/domain/tier, persists the change, and audits the tier change.
  @Test
  void updatesNameDomainAndTierAndAuditsTierChange() {
    Tenant existing = existingTenant(5L, "Salon Viejo", "old.pelu.app", tier);
    lenient().when(tenantRepository.findById(5L)).thenReturn(Optional.of(existing));
    lenient()
        .when(tenantRepository.findByDomainAndIdNot("new.pelu.app", 5L))
        .thenReturn(Optional.empty());

    TenantResponse response =
        service.update(
            5L, new TenantUpdateRequest("Salon Nuevo", "new.pelu.app", 2L), 42L, "admin@pelu.app");

    assertThat(response.name()).isEqualTo("Salon Nuevo");
    assertThat(response.domain()).isEqualTo("new.pelu.app");
    assertThat(response.tierId()).isEqualTo(2L);
    assertThat(response.tierName()).isEqualTo("Premium");

    ArgumentCaptor<TenantTierChange> captor = ArgumentCaptor.forClass(TenantTierChange.class);
    Mockito.verify(tenantTierChangeRepository).save(captor.capture());
    TenantTierChange saved = captor.getValue();
    assertThat(saved.getTenantId()).isEqualTo(5L);
    assertThat(saved.getPreviousTierId()).isEqualTo(1L);
    assertThat(saved.getPreviousTierName()).isEqualTo("Estándar");
    assertThat(saved.getNewTierId()).isEqualTo(2L);
    assertThat(saved.getNewTierName()).isEqualTo("Premium");
    assertThat(saved.getChangedByUserId()).isEqualTo(42L);
    assertThat(saved.getChangedByEmail()).isEqualTo("admin@pelu.app");
  }

  // HU-38 AC-3/AC-4: keeping the same tier doesn't write a spurious audit row (and, since this
  // service never touches tenant_feature_flags, existing overrides are untouched either way).
  @Test
  void doesNotAuditWhenTierIsUnchanged() {
    Tenant existing = existingTenant(6L, "Salon", "salon.pelu.app", tier);
    lenient().when(tenantRepository.findById(6L)).thenReturn(Optional.of(existing));
    lenient()
        .when(tenantRepository.findByDomainAndIdNot("salon.pelu.app", 6L))
        .thenReturn(Optional.empty());

    service.update(
        6L,
        new TenantUpdateRequest("Salon Renombrado", "salon.pelu.app", 1L),
        42L,
        "admin@pelu.app");

    Mockito.verify(tenantTierChangeRepository, Mockito.never()).save(any(TenantTierChange.class));
  }

  // HU-38 AC-2: domain uniqueness excludes the tenant being edited — keeping its own domain must
  // not be rejected as a duplicate of itself.
  @Test
  void allowsKeepingItsOwnDomain() {
    Tenant existing = existingTenant(7L, "Salon", "own.pelu.app", tier);
    lenient().when(tenantRepository.findById(7L)).thenReturn(Optional.of(existing));
    lenient()
        .when(tenantRepository.findByDomainAndIdNot("own.pelu.app", 7L))
        .thenReturn(Optional.empty());

    TenantResponse response =
        service.update(7L, new TenantUpdateRequest("Salon", "own.pelu.app", 1L), 1L, "a@b.com");

    assertThat(response.domain()).isEqualTo("own.pelu.app");
  }

  @Test
  void rejectsUpdateOfUnknownTenant() {
    lenient().when(tenantRepository.findById(404L)).thenReturn(Optional.empty());

    assertThatThrownBy(
            () -> service.update(404L, new TenantUpdateRequest("Salon", null, 1L), 1L, "a@b.com"))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("TENANT_NOT_FOUND");
  }

  @Test
  void rejectsBlankNameOnUpdate() {
    Tenant existing = existingTenant(8L, "Salon", null, tier);
    lenient().when(tenantRepository.findById(8L)).thenReturn(Optional.of(existing));

    assertThatThrownBy(
            () -> service.update(8L, new TenantUpdateRequest("   ", null, 1L), 1L, "a@b.com"))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("TENANT_NAME_REQUIRED");
  }

  @Test
  void rejectsDuplicateDomainOnUpdateAgainstAnotherTenant() {
    Tenant existing = existingTenant(9L, "Salon", "own.pelu.app", tier);
    lenient().when(tenantRepository.findById(9L)).thenReturn(Optional.of(existing));
    Tenant other = existingTenant(10L, "Otro salón", "taken.pelu.app", tier);
    lenient()
        .when(tenantRepository.findByDomainAndIdNot("taken.pelu.app", 9L))
        .thenReturn(Optional.of(other));

    assertThatThrownBy(
            () ->
                service.update(
                    9L, new TenantUpdateRequest("Salon", "taken.pelu.app", 1L), 1L, "a@b.com"))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("TENANT_DOMAIN_DUPLICATE");
  }

  @Test
  void rejectsMissingTierOnUpdate() {
    Tenant existing = existingTenant(11L, "Salon", null, tier);
    lenient().when(tenantRepository.findById(11L)).thenReturn(Optional.of(existing));

    assertThatThrownBy(
            () -> service.update(11L, new TenantUpdateRequest("Salon", null, null), 1L, "a@b.com"))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("TENANT_TIER_REQUIRED");
  }

  @Test
  void rejectsUnknownTierOnUpdate() {
    Tenant existing = existingTenant(12L, "Salon", null, tier);
    lenient().when(tenantRepository.findById(12L)).thenReturn(Optional.of(existing));
    lenient().when(tierRepository.findById(99L)).thenReturn(Optional.empty());

    assertThatThrownBy(
            () -> service.update(12L, new TenantUpdateRequest("Salon", null, 99L), 1L, "a@b.com"))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("TIER_NOT_FOUND");
  }
}
