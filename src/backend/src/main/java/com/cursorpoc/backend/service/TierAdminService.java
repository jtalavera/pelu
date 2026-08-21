package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.Tier;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.repository.TierRepository;
import com.cursorpoc.backend.web.dto.TierCreateRequest;
import com.cursorpoc.backend.web.dto.TierResponse;
import com.cursorpoc.backend.web.dto.TierUpdateRequest;
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
 * enforcement (AC-5). Does not touch tier&lt;-&gt;feature-flag association (HU-46) or 3-level flag
 * resolution (HU-47) — out of this story's scope.
 */
@Service
public class TierAdminService {

  private final TierRepository tierRepository;
  private final TenantRepository tenantRepository;

  public TierAdminService(TierRepository tierRepository, TenantRepository tenantRepository) {
    this.tierRepository = tierRepository;
    this.tenantRepository = tenantRepository;
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
}
