package com.cursorpoc.backend.service;

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
import com.cursorpoc.backend.web.dto.FeatureFlagResponse;
import com.cursorpoc.backend.web.dto.FeatureGlobalUpdateRequest;
import com.cursorpoc.backend.web.dto.TenantFeatureFlagChangeResponse;
import com.cursorpoc.backend.web.dto.TenantFeatureFlagOverrideRequest;
import com.cursorpoc.backend.web.dto.TenantFeatureFlagRowResponse;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-47 (Épica D — Tiers y Feature Flags): resolves a tenant's effective feature-flag value as the
 * <strong>conjunction (AND)</strong> of the 3 levels defined by the PRD ("Resolución de feature
 * flags"): global default AND the tenant's assigned tier's value (HU-46's {@link TierFeatureFlag})
 * AND the tenant's own value ({@link TenantFeatureFlag}). A flag is effective only when every
 * applicable level is ON; an OFF at any level forces the effective value OFF. A missing row at a
 * level means "inherit" (ON) — each level can only <em>restrict</em> downward. A tenant without a
 * tier (defensive: {@code tenants.tier_id} is NOT NULL since V54) contributes ON for the tier term.
 */
@Service
public class FeatureFlagService {

  private static final Pattern FLAG_KEY_PATTERN = Pattern.compile("^[A-Z0-9_]{1,100}$");

  private final FeatureFlagRepository featureFlagRepository;
  private final TenantFeatureFlagRepository tenantFeatureFlagRepository;
  private final TenantFeatureFlagChangeRepository tenantFeatureFlagChangeRepository;
  private final TenantRepository tenantRepository;
  private final TierFeatureFlagRepository tierFeatureFlagRepository;
  private final FemmeTimeProperties timeProperties;

  public FeatureFlagService(
      FeatureFlagRepository featureFlagRepository,
      TenantFeatureFlagRepository tenantFeatureFlagRepository,
      TenantFeatureFlagChangeRepository tenantFeatureFlagChangeRepository,
      TenantRepository tenantRepository,
      TierFeatureFlagRepository tierFeatureFlagRepository,
      FemmeTimeProperties timeProperties) {
    this.featureFlagRepository = featureFlagRepository;
    this.tenantFeatureFlagRepository = tenantFeatureFlagRepository;
    this.tenantFeatureFlagChangeRepository = tenantFeatureFlagChangeRepository;
    this.tenantRepository = tenantRepository;
    this.tierFeatureFlagRepository = tierFeatureFlagRepository;
    this.timeProperties = timeProperties;
  }

  @Transactional(readOnly = true)
  public boolean isEnabled(String flagKey, long tenantId) {
    requireValidFlagKey(flagKey);
    boolean globalEnabled =
        featureFlagRepository.findByFlagKey(flagKey).map(FeatureFlag::isEnabled).orElse(false);
    boolean tierValue =
        findTierFlag(tenantId, flagKey).map(TierFeatureFlag::isEnabled).orElse(true);
    boolean tenantValue =
        tenantFeatureFlagRepository
            .findByTenantIdAndFlagKey(tenantId, flagKey)
            .map(TenantFeatureFlag::isEnabled)
            .orElse(true);
    return globalEnabled && tierValue && tenantValue;
  }

  @Transactional(readOnly = true)
  public Map<String, Boolean> resolveAll(long tenantId) {
    List<FeatureFlag> globals = featureFlagRepository.findAllByOrderByFlagKeyAsc();
    Long tierId = tenantTierId(tenantId);
    Map<String, Boolean> out = new LinkedHashMap<>();
    for (FeatureFlag g : globals) {
      String key = g.getFlagKey();
      boolean tierValue =
          tierId != null
              ? tierFeatureFlagRepository
                  .findByTierIdAndFlagKey(tierId, key)
                  .map(TierFeatureFlag::isEnabled)
                  .orElse(true)
              : true;
      boolean tenantValue =
          tenantFeatureFlagRepository
              .findByTenantIdAndFlagKey(tenantId, key)
              .map(TenantFeatureFlag::isEnabled)
              .orElse(true);
      out.put(key, g.isEnabled() && tierValue && tenantValue);
    }
    return out;
  }

  /** HU-47: the tenant's assigned tier's id, or null when it has none. */
  private Long tenantTierId(long tenantId) {
    return tenantRepository.findById(tenantId).map(Tenant::getTier).map(Tier::getId).orElse(null);
  }

  private Optional<TierFeatureFlag> findTierFlag(long tenantId, String flagKey) {
    Long tierId = tenantTierId(tenantId);
    if (tierId == null) {
      return Optional.empty();
    }
    return tierFeatureFlagRepository.findByTierIdAndFlagKey(tierId, flagKey);
  }

  @Transactional(readOnly = true)
  public List<FeatureFlagResponse> listAllGlobals() {
    return featureFlagRepository.findAllByOrderByFlagKeyAsc().stream()
        .map(f -> new FeatureFlagResponse(f.getFlagKey(), f.isEnabled(), f.getDescription()))
        .toList();
  }

  @Transactional
  public FeatureFlagResponse updateGlobal(String flagKey, FeatureGlobalUpdateRequest request) {
    requireValidFlagKey(flagKey);
    FeatureFlag row =
        featureFlagRepository
            .findByFlagKey(flagKey)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "FLAG_NOT_FOUND"));
    row.setEnabled(request.enabled());
    if (request.description() != null) {
      row.setDescription(request.description());
    }
    featureFlagRepository.save(row);
    return new FeatureFlagResponse(row.getFlagKey(), row.isEnabled(), row.getDescription());
  }

  /**
   * HU-47 AC-4: every global flag for this tenant, alphabetical, showing the global default, the
   * tenant's tier value (if the tier defines it), the tenant's own value, and the resolved
   * effective value ({@code global AND tier AND tenant}). The caller derives which level(s) turned
   * a flag off from the individual booleans.
   */
  @Transactional(readOnly = true)
  public List<TenantFeatureFlagRowResponse> listTenantView(long tenantId) {
    requireTenant(tenantId);
    Long tierId = tenantTierId(tenantId);
    List<FeatureFlag> globals = featureFlagRepository.findAllByOrderByFlagKeyAsc();
    return globals.stream()
        .map(
            g -> {
              String key = g.getFlagKey();
              Optional<TenantFeatureFlag> override =
                  tenantFeatureFlagRepository.findByTenantIdAndFlagKey(tenantId, key);
              Optional<TierFeatureFlag> tierFlag =
                  tierId != null
                      ? tierFeatureFlagRepository.findByTierIdAndFlagKey(tierId, key)
                      : Optional.empty();
              boolean tierValue = tierFlag.map(TierFeatureFlag::isEnabled).orElse(true);
              boolean tenantValue = override.map(TenantFeatureFlag::isEnabled).orElse(true);
              boolean effectiveEnabled = g.isEnabled() && tierValue && tenantValue;
              TenantFeatureFlagChangeResponse lastChange =
                  tenantFeatureFlagChangeRepository
                      .findByTenantIdAndFlagKey(tenantId, key)
                      .map(this::toChangeResponse)
                      .orElse(null);
              return new TenantFeatureFlagRowResponse(
                  key,
                  g.getDescription(),
                  g.isEnabled(),
                  tierFlag.isPresent(),
                  tierFlag.map(TierFeatureFlag::isEnabled).orElse(null),
                  override.isPresent(),
                  override.map(TenantFeatureFlag::isEnabled).orElse(null),
                  effectiveEnabled,
                  lastChange);
            })
        .toList();
  }

  @Transactional
  public void upsertTenantOverride(
      long tenantId,
      String flagKey,
      TenantFeatureFlagOverrideRequest request,
      long changedByUserId,
      String changedByEmail) {
    requireValidFlagKey(flagKey);
    requireTenant(tenantId);
    featureFlagRepository
        .findByFlagKey(flagKey)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "FLAG_NOT_FOUND"));
    boolean previousEnabled = isEnabled(flagKey, tenantId);
    TenantFeatureFlag row =
        tenantFeatureFlagRepository
            .findByTenantIdAndFlagKey(tenantId, flagKey)
            .orElseGet(
                () -> {
                  TenantFeatureFlag t = new TenantFeatureFlag();
                  t.setTenantId(tenantId);
                  t.setFlagKey(flagKey);
                  return t;
                });
    row.setEnabled(request.enabled());
    tenantFeatureFlagRepository.save(row);
    recordChange(
        tenantId, flagKey, previousEnabled, request.enabled(), changedByUserId, changedByEmail);
  }

  @Transactional
  public void deleteTenantOverride(
      long tenantId, String flagKey, long changedByUserId, String changedByEmail) {
    requireValidFlagKey(flagKey);
    requireTenant(tenantId);
    boolean previousEnabled = isEnabled(flagKey, tenantId);
    tenantFeatureFlagRepository.deleteByTenantIdAndFlagKey(tenantId, flagKey);
    boolean newEnabled = isEnabled(flagKey, tenantId);
    recordChange(tenantId, flagKey, previousEnabled, newEnabled, changedByUserId, changedByEmail);
  }

  /**
   * SIFEN HU-22 AC-05: upserts the single "last change" record for this (tenant, flag) pair — same
   * "overwritten, not appended" convention as every other historical-record AC in this integration.
   */
  private void recordChange(
      long tenantId,
      String flagKey,
      boolean previousEnabled,
      boolean newEnabled,
      long changedByUserId,
      String changedByEmail) {
    TenantFeatureFlagChange change =
        tenantFeatureFlagChangeRepository
            .findByTenantIdAndFlagKey(tenantId, flagKey)
            .orElseGet(
                () -> {
                  TenantFeatureFlagChange c = new TenantFeatureFlagChange();
                  c.setTenantId(tenantId);
                  c.setFlagKey(flagKey);
                  return c;
                });
    change.setPreviousEnabled(previousEnabled);
    change.setNewEnabled(newEnabled);
    change.setChangedAt(LocalDateTime.now(timeProperties.zoneId()));
    change.setChangedByUserId(changedByUserId);
    change.setChangedByEmail(changedByEmail);
    tenantFeatureFlagChangeRepository.save(change);
  }

  private TenantFeatureFlagChangeResponse toChangeResponse(TenantFeatureFlagChange change) {
    return new TenantFeatureFlagChangeResponse(
        change.getChangedAt().atZone(timeProperties.zoneId()).toInstant(),
        change.getChangedByEmail(),
        change.isPreviousEnabled(),
        change.isNewEnabled());
  }

  private void requireTenant(long tenantId) {
    if (!tenantRepository.existsById(tenantId)) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND");
    }
  }

  private static void requireValidFlagKey(String flagKey) {
    if (flagKey == null || !FLAG_KEY_PATTERN.matcher(flagKey).matches()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_FLAG_KEY");
    }
  }
}
