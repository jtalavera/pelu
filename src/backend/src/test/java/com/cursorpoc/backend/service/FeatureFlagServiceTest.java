package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.FeatureFlag;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.TenantFeatureFlag;
import com.cursorpoc.backend.domain.TenantFeatureFlagChange;
import com.cursorpoc.backend.domain.Tier;
import com.cursorpoc.backend.domain.TierFeatureFlag;
import com.cursorpoc.backend.repository.FeatureFlagRepository;
import com.cursorpoc.backend.repository.TenantFeatureFlagChangeRepository;
import com.cursorpoc.backend.repository.TenantFeatureFlagRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.repository.TierFeatureFlagRepository;
import com.cursorpoc.backend.web.dto.FeatureGlobalUpdateRequest;
import com.cursorpoc.backend.web.dto.TenantFeatureFlagOverrideRequest;
import com.cursorpoc.backend.web.dto.TenantFeatureFlagRowResponse;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-47 (revisión 2026-09-09): la resolución de un flag es la conjunción (AND) de global, tier y
 * tenant. Un flag está ON solo si está ON en los 3 niveles; una fila ausente en un nivel = ON
 * (heredar); un OFF en cualquier nivel apaga el efectivo.
 */
@ExtendWith(MockitoExtension.class)
class FeatureFlagServiceTest {

  @Mock private FeatureFlagRepository featureFlagRepository;
  @Mock private TenantFeatureFlagRepository tenantFeatureFlagRepository;
  @Mock private TenantFeatureFlagChangeRepository tenantFeatureFlagChangeRepository;
  @Mock private TenantRepository tenantRepository;
  @Mock private TierFeatureFlagRepository tierFeatureFlagRepository;
  @Spy private FemmeTimeProperties timeProperties = new FemmeTimeProperties();

  @InjectMocks private FeatureFlagService featureFlagService;

  private FeatureFlag globalGuided;

  @BeforeEach
  void setUp() {
    globalGuided = new FeatureFlag();
    globalGuided.setId(1L);
    globalGuided.setFlagKey("GUIDED_TOUR");
    globalGuided.setEnabled(true);
    globalGuided.setDescription("desc");
  }

  private static Tenant tenantWithTier(long tierId) {
    Tier tier = new Tier();
    tier.setId(tierId);
    Tenant tenant = new Tenant();
    tenant.setTier(tier);
    return tenant;
  }

  private static TierFeatureFlag tierFlag(boolean enabled) {
    TierFeatureFlag f = new TierFeatureFlag();
    f.setEnabled(enabled);
    return f;
  }

  private static TenantFeatureFlag tenantFlag(boolean enabled) {
    TenantFeatureFlag f = new TenantFeatureFlag();
    f.setEnabled(enabled);
    return f;
  }

  // ---------- isEnabled: conjunctive resolution ----------

  @Test
  void isEnabled_allLevelsOn_returnsTrue() {
    when(featureFlagRepository.findByFlagKey("GUIDED_TOUR")).thenReturn(Optional.of(globalGuided));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenantWithTier(10L)));
    when(tierFeatureFlagRepository.findByTierIdAndFlagKey(10L, "GUIDED_TOUR"))
        .thenReturn(Optional.empty());
    when(tenantFeatureFlagRepository.findByTenantIdAndFlagKey(1L, "GUIDED_TOUR"))
        .thenReturn(Optional.empty());

    assertThat(featureFlagService.isEnabled("GUIDED_TOUR", 1L)).isTrue();
  }

  @Test
  void isEnabled_globalOff_forcesOffRegardlessOfTierAndTenant() {
    globalGuided.setEnabled(false);
    when(featureFlagRepository.findByFlagKey("GUIDED_TOUR")).thenReturn(Optional.of(globalGuided));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenantWithTier(10L)));
    when(tierFeatureFlagRepository.findByTierIdAndFlagKey(10L, "GUIDED_TOUR"))
        .thenReturn(Optional.of(tierFlag(true)));
    when(tenantFeatureFlagRepository.findByTenantIdAndFlagKey(1L, "GUIDED_TOUR"))
        .thenReturn(Optional.of(tenantFlag(true)));

    assertThat(featureFlagService.isEnabled("GUIDED_TOUR", 1L)).isFalse();
  }

  @Test
  void isEnabled_tierOff_forcesOffEvenWhenGlobalAndTenantOn() {
    when(featureFlagRepository.findByFlagKey("GUIDED_TOUR")).thenReturn(Optional.of(globalGuided));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenantWithTier(10L)));
    when(tierFeatureFlagRepository.findByTierIdAndFlagKey(10L, "GUIDED_TOUR"))
        .thenReturn(Optional.of(tierFlag(false)));
    when(tenantFeatureFlagRepository.findByTenantIdAndFlagKey(1L, "GUIDED_TOUR"))
        .thenReturn(Optional.of(tenantFlag(true)));

    assertThat(featureFlagService.isEnabled("GUIDED_TOUR", 1L)).isFalse();
  }

  @Test
  void isEnabled_tenantOff_forcesOffEvenWhenGlobalAndTierOn() {
    when(featureFlagRepository.findByFlagKey("GUIDED_TOUR")).thenReturn(Optional.of(globalGuided));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenantWithTier(10L)));
    when(tierFeatureFlagRepository.findByTierIdAndFlagKey(10L, "GUIDED_TOUR"))
        .thenReturn(Optional.of(tierFlag(true)));
    when(tenantFeatureFlagRepository.findByTenantIdAndFlagKey(1L, "GUIDED_TOUR"))
        .thenReturn(Optional.of(tenantFlag(false)));

    assertThat(featureFlagService.isEnabled("GUIDED_TOUR", 1L)).isFalse();
  }

  @Test
  void isEnabled_missingTierAndTenantRows_meanInheritOn() {
    when(featureFlagRepository.findByFlagKey("GUIDED_TOUR")).thenReturn(Optional.of(globalGuided));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenantWithTier(10L)));
    when(tierFeatureFlagRepository.findByTierIdAndFlagKey(10L, "GUIDED_TOUR"))
        .thenReturn(Optional.empty());
    when(tenantFeatureFlagRepository.findByTenantIdAndFlagKey(1L, "GUIDED_TOUR"))
        .thenReturn(Optional.empty());

    assertThat(featureFlagService.isEnabled("GUIDED_TOUR", 1L)).isTrue();
  }

  /** Defensive: {@code tenants.tier_id} is NOT NULL since V54, but a null tier still resolves. */
  @Test
  void isEnabled_tenantWithoutTier_tierTermIsOn() {
    when(featureFlagRepository.findByFlagKey("GUIDED_TOUR")).thenReturn(Optional.of(globalGuided));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(new Tenant()));
    when(tenantFeatureFlagRepository.findByTenantIdAndFlagKey(1L, "GUIDED_TOUR"))
        .thenReturn(Optional.empty());

    assertThat(featureFlagService.isEnabled("GUIDED_TOUR", 1L)).isTrue();
    verify(tierFeatureFlagRepository, never()).findByTierIdAndFlagKey(anyLong(), any());
  }

  @Test
  void isEnabled_unknownFlag_returnsFalse() {
    when(featureFlagRepository.findByFlagKey("UNKNOWN")).thenReturn(Optional.empty());
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenantWithTier(10L)));
    when(tierFeatureFlagRepository.findByTierIdAndFlagKey(10L, "UNKNOWN"))
        .thenReturn(Optional.empty());
    when(tenantFeatureFlagRepository.findByTenantIdAndFlagKey(1L, "UNKNOWN"))
        .thenReturn(Optional.empty());

    assertThat(featureFlagService.isEnabled("UNKNOWN", 1L)).isFalse();
  }

  @Test
  void isEnabled_invalidKey_throws() {
    assertThatThrownBy(() -> featureFlagService.isEnabled("bad-key", 1L))
        .isInstanceOf(ResponseStatusException.class)
        .extracting("statusCode")
        .isEqualTo(HttpStatus.BAD_REQUEST);
  }

  // ---------- resolveAll ----------

  @Test
  void resolveAll_andsAllThreeLevels() {
    FeatureFlag other = new FeatureFlag();
    other.setFlagKey("OTHER");
    other.setEnabled(true);
    when(featureFlagRepository.findAllByOrderByFlagKeyAsc())
        .thenReturn(List.of(other, globalGuided));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenantWithTier(10L)));
    // GUIDED_TOUR: tier turns it off -> effective off.
    when(tierFeatureFlagRepository.findByTierIdAndFlagKey(10L, "GUIDED_TOUR"))
        .thenReturn(Optional.of(tierFlag(false)));
    when(tenantFeatureFlagRepository.findByTenantIdAndFlagKey(1L, "GUIDED_TOUR"))
        .thenReturn(Optional.empty());
    // OTHER: global + tier inherit on, tenant turns it off -> effective off.
    when(tierFeatureFlagRepository.findByTierIdAndFlagKey(10L, "OTHER"))
        .thenReturn(Optional.empty());
    when(tenantFeatureFlagRepository.findByTenantIdAndFlagKey(1L, "OTHER"))
        .thenReturn(Optional.of(tenantFlag(false)));

    var map = featureFlagService.resolveAll(1L);
    assertThat(map).containsEntry("GUIDED_TOUR", false).containsEntry("OTHER", false);
  }

  @Test
  void resolveAll_allLevelsOn_returnsTrue() {
    when(featureFlagRepository.findAllByOrderByFlagKeyAsc()).thenReturn(List.of(globalGuided));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenantWithTier(10L)));
    when(tierFeatureFlagRepository.findByTierIdAndFlagKey(10L, "GUIDED_TOUR"))
        .thenReturn(Optional.empty());
    when(tenantFeatureFlagRepository.findByTenantIdAndFlagKey(1L, "GUIDED_TOUR"))
        .thenReturn(Optional.empty());

    assertThat(featureFlagService.resolveAll(1L)).containsEntry("GUIDED_TOUR", true);
  }

  /** Defensive: a tenant with no tier contributes ON for the tier term. */
  @Test
  void resolveAll_tenantWithoutTier_tierTermIsOn() {
    when(featureFlagRepository.findAllByOrderByFlagKeyAsc()).thenReturn(List.of(globalGuided));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(new Tenant()));
    when(tenantFeatureFlagRepository.findByTenantIdAndFlagKey(1L, "GUIDED_TOUR"))
        .thenReturn(Optional.empty());

    assertThat(featureFlagService.resolveAll(1L)).containsEntry("GUIDED_TOUR", true);
    verify(tierFeatureFlagRepository, never()).findByTierIdAndFlagKey(anyLong(), any());
  }

  // ---------- tenant override write path ----------

  @Test
  void upsertTenantOverride_createsRow() {
    when(tenantRepository.existsById(1L)).thenReturn(true);
    when(featureFlagRepository.findByFlagKey("GUIDED_TOUR")).thenReturn(Optional.of(globalGuided));
    when(tenantFeatureFlagRepository.findByTenantIdAndFlagKey(1L, "GUIDED_TOUR"))
        .thenReturn(Optional.empty());
    when(tenantFeatureFlagRepository.save(any(TenantFeatureFlag.class)))
        .thenAnswer(
            inv -> {
              TenantFeatureFlag t = inv.getArgument(0);
              t.setId(99L);
              return t;
            });
    when(tenantFeatureFlagChangeRepository.findByTenantIdAndFlagKey(1L, "GUIDED_TOUR"))
        .thenReturn(Optional.empty());

    featureFlagService.upsertTenantOverride(
        1L, "GUIDED_TOUR", new TenantFeatureFlagOverrideRequest(false), 7L, "admin@example.com");
    verify(tenantFeatureFlagRepository).save(any(TenantFeatureFlag.class));
  }

  /**
   * SIFEN HU-22 AC-05: the recorded change captures who made it and the resolved value before and
   * after — the tenant had no prior row (previous = global AND tier = true), turning it off records
   * true→false.
   */
  @Test
  void upsertTenantOverride_recordsChangeWithPreviousAndNewValue() {
    when(tenantRepository.existsById(1L)).thenReturn(true);
    when(featureFlagRepository.findByFlagKey("GUIDED_TOUR")).thenReturn(Optional.of(globalGuided));
    when(tenantFeatureFlagRepository.findByTenantIdAndFlagKey(1L, "GUIDED_TOUR"))
        .thenReturn(Optional.empty());
    when(tenantFeatureFlagRepository.save(any(TenantFeatureFlag.class)))
        .thenAnswer(inv -> inv.getArgument(0));
    when(tenantFeatureFlagChangeRepository.findByTenantIdAndFlagKey(1L, "GUIDED_TOUR"))
        .thenReturn(Optional.empty());
    when(tenantFeatureFlagChangeRepository.save(any(TenantFeatureFlagChange.class)))
        .thenAnswer(inv -> inv.getArgument(0));

    featureFlagService.upsertTenantOverride(
        1L, "GUIDED_TOUR", new TenantFeatureFlagOverrideRequest(false), 7L, "admin@example.com");

    var captor = org.mockito.ArgumentCaptor.forClass(TenantFeatureFlagChange.class);
    verify(tenantFeatureFlagChangeRepository).save(captor.capture());
    TenantFeatureFlagChange change = captor.getValue();
    assertThat(change.getTenantId()).isEqualTo(1L);
    assertThat(change.getFlagKey()).isEqualTo("GUIDED_TOUR");
    assertThat(change.isPreviousEnabled()).isTrue();
    assertThat(change.isNewEnabled()).isFalse();
    assertThat(change.getChangedByUserId()).isEqualTo(7L);
    assertThat(change.getChangedByEmail()).isEqualTo("admin@example.com");
    assertThat(change.getChangedAt()).isNotNull();
  }

  /** SIFEN HU-22 AC-02: writing tenant 1's value never reads or writes another tenant's rows. */
  @Test
  void upsertTenantOverride_neverAffectsAnotherTenant() {
    when(tenantRepository.existsById(1L)).thenReturn(true);
    when(featureFlagRepository.findByFlagKey("GUIDED_TOUR")).thenReturn(Optional.of(globalGuided));
    when(tenantFeatureFlagRepository.findByTenantIdAndFlagKey(1L, "GUIDED_TOUR"))
        .thenReturn(Optional.empty());
    when(tenantFeatureFlagRepository.save(any(TenantFeatureFlag.class)))
        .thenAnswer(inv -> inv.getArgument(0));
    when(tenantFeatureFlagChangeRepository.findByTenantIdAndFlagKey(1L, "GUIDED_TOUR"))
        .thenReturn(Optional.empty());
    when(tenantFeatureFlagChangeRepository.save(any(TenantFeatureFlagChange.class)))
        .thenAnswer(inv -> inv.getArgument(0));

    featureFlagService.upsertTenantOverride(
        1L, "GUIDED_TOUR", new TenantFeatureFlagOverrideRequest(false), 7L, "admin@example.com");

    verify(tenantFeatureFlagRepository, never()).findByTenantIdAndFlagKey(eq(2L), any());
    verify(tenantFeatureFlagChangeRepository, never()).findByTenantIdAndFlagKey(eq(2L), any());
  }

  // ---------- tenant admin view ----------

  @Test
  void listTenantView_effectiveIsAndOfGlobalTierTenant_tierOff() {
    when(tenantRepository.existsById(1L)).thenReturn(true);
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenantWithTier(10L)));
    when(featureFlagRepository.findAllByOrderByFlagKeyAsc()).thenReturn(List.of(globalGuided));
    when(tenantFeatureFlagRepository.findByTenantIdAndFlagKey(1L, "GUIDED_TOUR"))
        .thenReturn(Optional.empty());
    when(tierFeatureFlagRepository.findByTierIdAndFlagKey(10L, "GUIDED_TOUR"))
        .thenReturn(Optional.of(tierFlag(false)));
    when(tenantFeatureFlagChangeRepository.findByTenantIdAndFlagKey(1L, "GUIDED_TOUR"))
        .thenReturn(Optional.empty());

    List<TenantFeatureFlagRowResponse> rows = featureFlagService.listTenantView(1L);
    assertThat(rows).hasSize(1);
    TenantFeatureFlagRowResponse row = rows.get(0);
    assertThat(row.globalEnabled()).isTrue();
    assertThat(row.hasTier()).isTrue();
    assertThat(row.tierEnabled()).isFalse();
    assertThat(row.hasOverride()).isFalse();
    assertThat(row.overrideEnabled()).isNull();
    assertThat(row.effectiveEnabled()).isFalse();
  }

  @Test
  void listTenantView_tenantValueOffTurnsEffectiveOff() {
    when(tenantRepository.existsById(1L)).thenReturn(true);
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenantWithTier(10L)));
    when(featureFlagRepository.findAllByOrderByFlagKeyAsc()).thenReturn(List.of(globalGuided));
    when(tenantFeatureFlagRepository.findByTenantIdAndFlagKey(1L, "GUIDED_TOUR"))
        .thenReturn(Optional.of(tenantFlag(false)));
    when(tierFeatureFlagRepository.findByTierIdAndFlagKey(10L, "GUIDED_TOUR"))
        .thenReturn(Optional.empty());
    when(tenantFeatureFlagChangeRepository.findByTenantIdAndFlagKey(1L, "GUIDED_TOUR"))
        .thenReturn(Optional.empty());

    TenantFeatureFlagRowResponse row = featureFlagService.listTenantView(1L).get(0);
    assertThat(row.hasTier()).isFalse();
    assertThat(row.tierEnabled()).isNull();
    assertThat(row.hasOverride()).isTrue();
    assertThat(row.overrideEnabled()).isFalse();
    assertThat(row.effectiveEnabled()).isFalse();
  }

  @Test
  void listTenantView_allLevelsOn_effectiveOn() {
    when(tenantRepository.existsById(1L)).thenReturn(true);
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenantWithTier(10L)));
    when(featureFlagRepository.findAllByOrderByFlagKeyAsc()).thenReturn(List.of(globalGuided));
    when(tenantFeatureFlagRepository.findByTenantIdAndFlagKey(1L, "GUIDED_TOUR"))
        .thenReturn(Optional.empty());
    when(tierFeatureFlagRepository.findByTierIdAndFlagKey(10L, "GUIDED_TOUR"))
        .thenReturn(Optional.empty());
    when(tenantFeatureFlagChangeRepository.findByTenantIdAndFlagKey(1L, "GUIDED_TOUR"))
        .thenReturn(Optional.empty());

    TenantFeatureFlagRowResponse row = featureFlagService.listTenantView(1L).get(0);
    assertThat(row.effectiveEnabled()).isTrue();
    assertThat(row.hasTier()).isFalse();
    assertThat(row.hasOverride()).isFalse();
  }

  @Test
  void updateGlobal_updatesDescriptionWhenProvided() {
    when(featureFlagRepository.findByFlagKey("GUIDED_TOUR")).thenReturn(Optional.of(globalGuided));
    when(featureFlagRepository.save(any(FeatureFlag.class))).thenAnswer(inv -> inv.getArgument(0));

    var res =
        featureFlagService.updateGlobal(
            "GUIDED_TOUR", new FeatureGlobalUpdateRequest(false, "new desc"));
    assertThat(res.enabled()).isFalse();
    assertThat(globalGuided.getDescription()).isEqualTo("new desc");
  }
}
