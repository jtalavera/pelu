package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.FeatureFlag;
import com.cursorpoc.backend.domain.TenantFeatureFlag;
import com.cursorpoc.backend.repository.FeatureFlagRepository;
import com.cursorpoc.backend.repository.TenantFeatureFlagRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.FeatureFlagResponse;
import com.cursorpoc.backend.web.dto.FeatureGlobalUpdateRequest;
import com.cursorpoc.backend.web.dto.TenantFeatureFlagOverrideRequest;
import com.cursorpoc.backend.web.dto.TenantFeatureFlagRowResponse;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class FeatureFlagService {

  private static final Pattern FLAG_KEY_PATTERN = Pattern.compile("^[A-Z0-9_]{1,100}$");

  private final FeatureFlagRepository featureFlagRepository;
  private final TenantFeatureFlagRepository tenantFeatureFlagRepository;
  private final TenantRepository tenantRepository;

  public FeatureFlagService(
      FeatureFlagRepository featureFlagRepository,
      TenantFeatureFlagRepository tenantFeatureFlagRepository,
      TenantRepository tenantRepository) {
    this.featureFlagRepository = featureFlagRepository;
    this.tenantFeatureFlagRepository = tenantFeatureFlagRepository;
    this.tenantRepository = tenantRepository;
  }

  @Transactional(readOnly = true)
  public boolean isEnabled(String flagKey, long tenantId) {
    requireValidFlagKey(flagKey);
    Optional<TenantFeatureFlag> override =
        tenantFeatureFlagRepository.findByTenantIdAndFlagKey(tenantId, flagKey);
    if (override.isPresent()) {
      return override.get().isEnabled();
    }
    return featureFlagRepository.findByFlagKey(flagKey).map(FeatureFlag::isEnabled).orElse(false);
  }

  @Transactional(readOnly = true)
  public Map<String, Boolean> resolveAll(long tenantId) {
    List<FeatureFlag> globals = featureFlagRepository.findAllByOrderByFlagKeyAsc();
    Map<String, Boolean> out = new LinkedHashMap<>();
    for (FeatureFlag g : globals) {
      String key = g.getFlagKey();
      Optional<TenantFeatureFlag> override =
          tenantFeatureFlagRepository.findByTenantIdAndFlagKey(tenantId, key);
      boolean value = override.map(TenantFeatureFlag::isEnabled).orElseGet(g::isEnabled);
      out.put(key, value);
    }
    return out;
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

  @Transactional(readOnly = true)
  public List<TenantFeatureFlagRowResponse> listTenantView(long tenantId) {
    requireTenant(tenantId);
    List<FeatureFlag> globals = featureFlagRepository.findAllByOrderByFlagKeyAsc();
    return globals.stream()
        .map(
            g -> {
              Optional<TenantFeatureFlag> override =
                  tenantFeatureFlagRepository.findByTenantIdAndFlagKey(tenantId, g.getFlagKey());
              return new TenantFeatureFlagRowResponse(
                  g.getFlagKey(),
                  g.getDescription(),
                  g.isEnabled(),
                  override.isPresent(),
                  override.map(TenantFeatureFlag::isEnabled).orElse(null));
            })
        .toList();
  }

  @Transactional
  public void upsertTenantOverride(
      long tenantId, String flagKey, TenantFeatureFlagOverrideRequest request) {
    requireValidFlagKey(flagKey);
    requireTenant(tenantId);
    featureFlagRepository
        .findByFlagKey(flagKey)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "FLAG_NOT_FOUND"));
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
  }

  @Transactional
  public void deleteTenantOverride(long tenantId, String flagKey) {
    requireValidFlagKey(flagKey);
    requireTenant(tenantId);
    tenantFeatureFlagRepository.deleteByTenantIdAndFlagKey(tenantId, flagKey);
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
