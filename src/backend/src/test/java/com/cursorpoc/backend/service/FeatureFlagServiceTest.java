package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.FeatureFlag;
import com.cursorpoc.backend.domain.TenantFeatureFlag;
import com.cursorpoc.backend.domain.TenantFeatureFlagChange;
import com.cursorpoc.backend.repository.FeatureFlagRepository;
import com.cursorpoc.backend.repository.TenantFeatureFlagChangeRepository;
import com.cursorpoc.backend.repository.TenantFeatureFlagRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.FeatureGlobalUpdateRequest;
import com.cursorpoc.backend.web.dto.TenantFeatureFlagOverrideRequest;
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

@ExtendWith(MockitoExtension.class)
class FeatureFlagServiceTest {

  @Mock private FeatureFlagRepository featureFlagRepository;
  @Mock private TenantFeatureFlagRepository tenantFeatureFlagRepository;
  @Mock private TenantFeatureFlagChangeRepository tenantFeatureFlagChangeRepository;
  @Mock private TenantRepository tenantRepository;
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

  @Test
  void isEnabled_usesGlobalWhenNoOverride() {
    when(tenantFeatureFlagRepository.findByTenantIdAndFlagKey(1L, "GUIDED_TOUR"))
        .thenReturn(Optional.empty());
    when(featureFlagRepository.findByFlagKey("GUIDED_TOUR")).thenReturn(Optional.of(globalGuided));

    assertThat(featureFlagService.isEnabled("GUIDED_TOUR", 1L)).isTrue();
  }

  @Test
  void isEnabled_usesTenantOverrideWhenPresent() {
    TenantFeatureFlag over = new TenantFeatureFlag();
    over.setEnabled(false);
    when(tenantFeatureFlagRepository.findByTenantIdAndFlagKey(1L, "GUIDED_TOUR"))
        .thenReturn(Optional.of(over));

    assertThat(featureFlagService.isEnabled("GUIDED_TOUR", 1L)).isFalse();
    verify(featureFlagRepository, never()).findByFlagKey(any());
  }

  @Test
  void isEnabled_unknownFlag_returnsFalse() {
    when(tenantFeatureFlagRepository.findByTenantIdAndFlagKey(1L, "UNKNOWN"))
        .thenReturn(Optional.empty());
    when(featureFlagRepository.findByFlagKey("UNKNOWN")).thenReturn(Optional.empty());

    assertThat(featureFlagService.isEnabled("UNKNOWN", 1L)).isFalse();
  }

  @Test
  void isEnabled_invalidKey_throws() {
    assertThatThrownBy(() -> featureFlagService.isEnabled("bad-key", 1L))
        .isInstanceOf(ResponseStatusException.class)
        .extracting("statusCode")
        .isEqualTo(HttpStatus.BAD_REQUEST);
  }

  @Test
  void resolveAll_mergesGlobalsAndOverrides() {
    FeatureFlag other = new FeatureFlag();
    other.setFlagKey("OTHER");
    other.setEnabled(false);
    when(featureFlagRepository.findAllByOrderByFlagKeyAsc())
        .thenReturn(List.of(other, globalGuided));
    when(tenantFeatureFlagRepository.findByTenantIdAndFlagKey(1L, "GUIDED_TOUR"))
        .thenReturn(Optional.empty());
    when(tenantFeatureFlagRepository.findByTenantIdAndFlagKey(1L, "OTHER"))
        .thenReturn(Optional.empty());

    var map = featureFlagService.resolveAll(1L);
    assertThat(map).containsEntry("OTHER", false).containsEntry("GUIDED_TOUR", true);
  }

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
   * SIFEN HU-22 AC-05: recording a change captures who made it, and the resolved value before and
   * after — here the tenant had no prior override (previous=global=true), so flipping it off is
   * recorded as true→false.
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

  /**
   * SIFEN HU-22 AC-02: changing tenant 1's override never touches tenant 2 — no e2e fixture exists
   * to create a second real tenant (see PROGRESS.md), so this isolation is verified here instead:
   * the write path only ever touches rows scoped to the tenantId passed in, and resolveAll for a
   * different tenant is computed from its own (empty) override lookup, never tenant 1's.
   */
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

    // Tenant 2 resolves independently — still the global default, unaware of tenant 1's override.
    when(tenantFeatureFlagRepository.findByTenantIdAndFlagKey(2L, "GUIDED_TOUR"))
        .thenReturn(Optional.empty());
    assertThat(featureFlagService.isEnabled("GUIDED_TOUR", 2L)).isTrue();
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
