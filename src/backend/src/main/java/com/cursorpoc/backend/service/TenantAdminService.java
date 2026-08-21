package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.TenantTierChange;
import com.cursorpoc.backend.domain.Tier;
import com.cursorpoc.backend.domain.enums.TenantStatus;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.repository.TenantTierChangeRepository;
import com.cursorpoc.backend.repository.TierRepository;
import com.cursorpoc.backend.web.dto.PageResponse;
import com.cursorpoc.backend.web.dto.TenantCreateRequest;
import com.cursorpoc.backend.web.dto.TenantResponse;
import com.cursorpoc.backend.web.dto.TenantTierChangeResponse;
import com.cursorpoc.backend.web.dto.TenantUpdateRequest;
import com.cursorpoc.backend.web.dto.TierOptionResponse;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Objects;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-37/HU-38/HU-39 (Épica B — Gestión de Tenants): Platform Admin creates, lists, searches, and
 * edits tenants.
 */
@Service
public class TenantAdminService {

  private final TenantRepository tenantRepository;
  private final TierRepository tierRepository;
  private final TenantTierChangeRepository tenantTierChangeRepository;
  private final FemmeTimeProperties timeProperties;

  public TenantAdminService(
      TenantRepository tenantRepository,
      TierRepository tierRepository,
      TenantTierChangeRepository tenantTierChangeRepository,
      FemmeTimeProperties timeProperties) {
    this.tenantRepository = tenantRepository;
    this.tierRepository = tierRepository;
    this.tenantTierChangeRepository = tenantTierChangeRepository;
    this.timeProperties = timeProperties;
  }

  /**
   * HU-39 AC-2: {@code q} filters by name or domain (case-insensitive, partial match), applied
   * server-side alongside the existing pagination (AC-3).
   */
  @Transactional(readOnly = true)
  public PageResponse<TenantResponse> listPaged(int page, int size, String q) {
    PageRequest pageable =
        PageRequest.of(
            Math.max(0, page), Math.max(1, Math.min(size, 200)), Sort.by("id").descending());
    String normalizedQ = q == null || q.isBlank() ? null : q.trim();
    Page<Tenant> result = tenantRepository.findFiltered(normalizedQ, pageable);
    List<TenantResponse> content = result.getContent().stream().map(this::toResponse).toList();
    return new PageResponse<>(
        content,
        result.getNumber(),
        result.getSize(),
        result.getTotalElements(),
        result.getTotalPages());
  }

  @Transactional(readOnly = true)
  public List<TierOptionResponse> listTiers() {
    return tierRepository.findAllByOrderByNameAsc().stream()
        .map(t -> new TierOptionResponse(t.getId(), t.getName()))
        .toList();
  }

  @Transactional
  public TenantResponse create(TenantCreateRequest request) {
    String name = request.name() == null ? "" : request.name().trim();
    if (name.isBlank()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "TENANT_NAME_REQUIRED");
    }

    String domain = request.domain() == null ? null : request.domain().trim();
    if (domain != null && domain.isBlank()) {
      domain = null;
    }
    if (domain != null && tenantRepository.findByDomain(domain).isPresent()) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "TENANT_DOMAIN_DUPLICATE");
    }

    if (request.tierId() == null) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "TENANT_TIER_REQUIRED");
    }
    Tier tier =
        tierRepository
            .findById(request.tierId())
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TIER_NOT_FOUND"));

    Tenant tenant = new Tenant();
    tenant.setName(name);
    tenant.setDomain(domain);
    tenant.setTier(tier);
    tenant.setStatus(TenantStatus.ACTIVE);
    tenantRepository.save(tenant);
    return toResponse(tenant);
  }

  /**
   * HU-38: AC-1 (edit name/domain/tier), AC-2 (same validations as create, domain uniqueness
   * excluding self), AC-3/AC-4 (tier change takes effect immediately — flag resolution reads {@code
   * Tenant#tier} live, nothing here caches it — without touching any existing per-tenant flag
   * override), AC-5 (persisted via the same {@code tenantRepository.save}, so a page reload
   * reflects it), AC-6 (tier changes are audited via {@link TenantTierChange}).
   */
  @Transactional
  public TenantResponse update(
      Long id, TenantUpdateRequest request, long changedByUserId, String changedByEmail) {
    Tenant tenant =
        tenantRepository
            .findById(id)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND"));

    String name = request.name() == null ? "" : request.name().trim();
    if (name.isBlank()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "TENANT_NAME_REQUIRED");
    }

    String domain = request.domain() == null ? null : request.domain().trim();
    if (domain != null && domain.isBlank()) {
      domain = null;
    }
    if (domain != null && tenantRepository.findByDomainAndIdNot(domain, id).isPresent()) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "TENANT_DOMAIN_DUPLICATE");
    }

    if (request.tierId() == null) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "TENANT_TIER_REQUIRED");
    }
    Tier newTier =
        tierRepository
            .findById(request.tierId())
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TIER_NOT_FOUND"));

    Tier previousTier = tenant.getTier();
    boolean tierChanged =
        !Objects.equals(previousTier != null ? previousTier.getId() : null, newTier.getId());

    tenant.setName(name);
    tenant.setDomain(domain);
    tenant.setTier(newTier);
    tenantRepository.save(tenant);

    if (tierChanged) {
      recordTierChange(tenant.getId(), previousTier, newTier, changedByUserId, changedByEmail);
    }

    return toResponse(tenant);
  }

  /**
   * SIFEN HU-22-style "single last result" upsert (see {@code FeatureFlagService.recordChange}):
   * one row per tenant, overwritten on each tier change rather than appended.
   */
  private void recordTierChange(
      Long tenantId, Tier previousTier, Tier newTier, long changedByUserId, String changedByEmail) {
    TenantTierChange change =
        tenantTierChangeRepository
            .findByTenantId(tenantId)
            .orElseGet(
                () -> {
                  TenantTierChange c = new TenantTierChange();
                  c.setTenantId(tenantId);
                  return c;
                });
    change.setPreviousTierId(previousTier != null ? previousTier.getId() : null);
    change.setPreviousTierName(previousTier != null ? previousTier.getName() : null);
    change.setNewTierId(newTier.getId());
    change.setNewTierName(newTier.getName());
    change.setChangedAt(LocalDateTime.now(timeProperties.zoneId()));
    change.setChangedByUserId(changedByUserId);
    change.setChangedByEmail(changedByEmail);
    tenantTierChangeRepository.save(change);
  }

  private TenantResponse toResponse(Tenant tenant) {
    Tier tier = tenant.getTier();
    TenantTierChangeResponse lastTierChange =
        tenantTierChangeRepository
            .findByTenantId(tenant.getId())
            .map(this::toTierChangeResponse)
            .orElse(null);
    return new TenantResponse(
        tenant.getId(),
        tenant.getName(),
        tenant.getDomain(),
        tier != null ? tier.getId() : null,
        tier != null ? tier.getName() : null,
        tenant.getStatus().name(),
        lastTierChange);
  }

  private TenantTierChangeResponse toTierChangeResponse(TenantTierChange change) {
    return new TenantTierChangeResponse(
        change.getChangedAt().atZone(timeProperties.zoneId()).toInstant(),
        change.getChangedByEmail(),
        change.getPreviousTierName(),
        change.getNewTierName());
  }
}
