package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.FeatureFlag;
import com.cursorpoc.backend.domain.Tier;
import com.cursorpoc.backend.domain.TierFeatureFlag;
import com.cursorpoc.backend.domain.TierFeatureFlagChange;
import com.cursorpoc.backend.repository.FeatureFlagRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.repository.TierFeatureFlagChangeRepository;
import com.cursorpoc.backend.repository.TierFeatureFlagRepository;
import com.cursorpoc.backend.repository.TierRepository;
import com.cursorpoc.backend.web.dto.TierCreateRequest;
import com.cursorpoc.backend.web.dto.TierFeatureFlagChangeResponse;
import com.cursorpoc.backend.web.dto.TierFeatureFlagRowResponse;
import com.cursorpoc.backend.web.dto.TierResponse;
import com.cursorpoc.backend.web.dto.TierUpdateRequest;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-45 (Épica D — Tiers y Feature Flags): full CRUD for {@link Tier}, the Platform Admin-defined
 * reusable packages a tenant can be assigned (see PRD "Tier" definition). The {@code Tier} entity
 * and its minimal option-list read (used by the tenant create/edit form, {@code
 * TenantAdminService#listTiers}) were introduced ahead of schedule by HU-37; this service adds the
 * create/edit/delete side, including the in-use delete protection (AC-3) and name-uniqueness
 * enforcement (AC-5).
 *
 * <p>HU-46 adds the tier&lt;-&gt;feature-flag association below (which flags are included in a
 * tier's default package, plus its audit trail) to this same service since it's tier-centric admin
 * work. It deliberately does NOT wire this association into flag resolution (that stays exactly
 * {@code FeatureFlagService}'s global-default-then-tenant-override chain) — actually consuming the
 * tier's package as the middle priority level is HU-47, out of this story's scope.
 */
@Service
public class TierAdminService {

  private final TierRepository tierRepository;
  private final TenantRepository tenantRepository;
  private final FeatureFlagRepository featureFlagRepository;
  private final TierFeatureFlagRepository tierFeatureFlagRepository;
  private final TierFeatureFlagChangeRepository tierFeatureFlagChangeRepository;
  private final FemmeTimeProperties timeProperties;

  public TierAdminService(
      TierRepository tierRepository,
      TenantRepository tenantRepository,
      FeatureFlagRepository featureFlagRepository,
      TierFeatureFlagRepository tierFeatureFlagRepository,
      TierFeatureFlagChangeRepository tierFeatureFlagChangeRepository,
      FemmeTimeProperties timeProperties) {
    this.tierRepository = tierRepository;
    this.tenantRepository = tenantRepository;
    this.featureFlagRepository = featureFlagRepository;
    this.tierFeatureFlagRepository = tierFeatureFlagRepository;
    this.tierFeatureFlagChangeRepository = tierFeatureFlagChangeRepository;
    this.timeProperties = timeProperties;
  }

  /** HU-45 AC-4: every tier, alphabetical, each with how many tenants currently use it. */
  @Transactional(readOnly = true)
  public List<TierResponse> listAll() {
    return tierRepository.findAllByOrderByNameAsc().stream().map(this::toResponse).toList();
  }

  /**
   * HU-45 AC-1/AC-5: name is required and must be unique (case-insensitive); description is
   * optional.
   */
  @Transactional
  public TierResponse create(TierCreateRequest request) {
    String name = request.name() == null ? "" : request.name().trim();
    if (name.isBlank()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "TIER_NAME_REQUIRED");
    }
    if (tierRepository.existsByNameIgnoreCase(name)) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "TIER_NAME_DUPLICATE");
    }

    String description = normalizeDescription(request.description());

    Tier tier = new Tier();
    tier.setName(name);
    tier.setDescription(description);
    tierRepository.save(tier);
    return toResponse(tier);
  }

  /** HU-45 AC-2/AC-5: editing name and/or description; name uniqueness excludes the tier itself. */
  @Transactional
  public TierResponse update(Long id, TierUpdateRequest request) {
    Tier tier =
        tierRepository
            .findById(id)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TIER_NOT_FOUND"));

    String name = request.name() == null ? "" : request.name().trim();
    if (name.isBlank()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "TIER_NAME_REQUIRED");
    }
    if (tierRepository.existsByNameIgnoreCaseAndIdNot(name, id)) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "TIER_NAME_DUPLICATE");
    }

    tier.setName(name);
    tier.setDescription(normalizeDescription(request.description()));
    tierRepository.save(tier);
    return toResponse(tier);
  }

  /**
   * HU-45 AC-3: a tier assigned to at least one tenant cannot be deleted — the caller (controller)
   * surfaces {@code TIER_IN_USE} together with the tenant count already shown in the listing, so
   * the UI can state a clear "N tenants use this tier" message without a second round-trip.
   */
  @Transactional
  public void delete(Long id) {
    Tier tier =
        tierRepository
            .findById(id)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TIER_NOT_FOUND"));

    long tenantCount = tenantRepository.countByTierId(id);
    if (tenantCount > 0) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "TIER_IN_USE");
    }

    tierRepository.delete(tier);
  }

  private static String normalizeDescription(String rawDescription) {
    if (rawDescription == null) {
      return null;
    }
    String trimmed = rawDescription.trim();
    return trimmed.isBlank() ? null : trimmed;
  }

  private TierResponse toResponse(Tier tier) {
    long tenantCount = tenantRepository.countByTierId(tier.getId());
    return new TierResponse(tier.getId(), tier.getName(), tier.getDescription(), tenantCount);
  }

  /**
   * HU-46 AC-1: every existing global flag, alphabetical, with whether this tier includes it in its
   * default package (AC-2: reflects whatever was last persisted) plus its audit trail (AC-5).
   */
  @Transactional(readOnly = true)
  public List<TierFeatureFlagRowResponse> listTierFeatureFlags(Long tierId) {
    requireTier(tierId);
    List<FeatureFlag> globals = featureFlagRepository.findAllByOrderByFlagKeyAsc();
    return globals.stream()
        .map(
            g -> {
              boolean included =
                  tierFeatureFlagRepository
                      .findByTierIdAndFlagKey(tierId, g.getFlagKey())
                      .isPresent();
              TierFeatureFlagChangeResponse lastChange =
                  tierFeatureFlagChangeRepository
                      .findByTierIdAndFlagKey(tierId, g.getFlagKey())
                      .map(this::toChangeResponse)
                      .orElse(null);
              return new TierFeatureFlagRowResponse(
                  g.getFlagKey(), g.getDescription(), g.isEnabled(), included, lastChange);
            })
        .toList();
  }

  /**
   * HU-46 AC-1/AC-2: marks a flag as included (or not) in this tier's default package. Included ->
   * upserts a {@link TierFeatureFlag} row (enabled=true); not included -> deletes any existing row,
   * so the tier goes back to having no opinion for that flag. AC-3: this never touches {@code
   * TenantFeatureFlag} rows, so existing tenant overrides in this tier are untouched. AC-5: always
   * records the change, who made it and when.
   */
  @Transactional
  public void setTierFeatureFlagIncluded(
      Long tierId, String flagKey, boolean included, long changedByUserId, String changedByEmail) {
    requireTier(tierId);
    featureFlagRepository
        .findByFlagKey(flagKey)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "FLAG_NOT_FOUND"));

    boolean previousIncluded =
        tierFeatureFlagRepository.findByTierIdAndFlagKey(tierId, flagKey).isPresent();

    if (included) {
      TierFeatureFlag row =
          tierFeatureFlagRepository
              .findByTierIdAndFlagKey(tierId, flagKey)
              .orElseGet(
                  () -> {
                    TierFeatureFlag t = new TierFeatureFlag();
                    t.setTierId(tierId);
                    t.setFlagKey(flagKey);
                    return t;
                  });
      row.setEnabled(true);
      tierFeatureFlagRepository.save(row);
    } else {
      tierFeatureFlagRepository.deleteByTierIdAndFlagKey(tierId, flagKey);
    }

    recordTierFlagChange(
        tierId, flagKey, previousIncluded, included, changedByUserId, changedByEmail);
  }

  private void recordTierFlagChange(
      Long tierId,
      String flagKey,
      boolean previousIncluded,
      boolean newIncluded,
      long changedByUserId,
      String changedByEmail) {
    TierFeatureFlagChange change =
        tierFeatureFlagChangeRepository
            .findByTierIdAndFlagKey(tierId, flagKey)
            .orElseGet(
                () -> {
                  TierFeatureFlagChange c = new TierFeatureFlagChange();
                  c.setTierId(tierId);
                  c.setFlagKey(flagKey);
                  return c;
                });
    change.setPreviousIncluded(previousIncluded);
    change.setNewIncluded(newIncluded);
    change.setChangedAt(LocalDateTime.now(timeProperties.zoneId()));
    change.setChangedByUserId(changedByUserId);
    change.setChangedByEmail(changedByEmail);
    tierFeatureFlagChangeRepository.save(change);
  }

  private TierFeatureFlagChangeResponse toChangeResponse(TierFeatureFlagChange change) {
    return new TierFeatureFlagChangeResponse(
        change.getChangedAt().atZone(timeProperties.zoneId()).toInstant(),
        change.getChangedByEmail(),
        change.isPreviousIncluded(),
        change.isNewIncluded());
  }

  private Tier requireTier(Long tierId) {
    return tierRepository
        .findById(tierId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TIER_NOT_FOUND"));
  }
}
