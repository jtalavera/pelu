package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Tax;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.TenantStatusChange;
import com.cursorpoc.backend.domain.TenantTierChange;
import com.cursorpoc.backend.domain.Tier;
import com.cursorpoc.backend.domain.enums.TenantStatus;
import com.cursorpoc.backend.repository.TaxRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.repository.TenantStatusChangeRepository;
import com.cursorpoc.backend.repository.TenantTierChangeRepository;
import com.cursorpoc.backend.repository.TierRepository;
import com.cursorpoc.backend.web.dto.PageResponse;
import com.cursorpoc.backend.web.dto.TenantCreateRequest;
import com.cursorpoc.backend.web.dto.TenantResponse;
import com.cursorpoc.backend.web.dto.TenantStatusChangeResponse;
import com.cursorpoc.backend.web.dto.TenantStatusUpdateRequest;
import com.cursorpoc.backend.web.dto.TenantTierChangeResponse;
import com.cursorpoc.backend.web.dto.TenantUpdateRequest;
import com.cursorpoc.backend.web.dto.TierOptionResponse;
import java.math.BigDecimal;
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
 * HU-37/HU-38/HU-39/HU-40 (Épica B — Gestión de Tenants): Platform Admin creates, lists, searches,
 * edits, and suspends/reactivates tenants.
 */
@Service
public class TenantAdminService {

  private final TenantRepository tenantRepository;
  private final TierRepository tierRepository;
  private final TenantTierChangeRepository tenantTierChangeRepository;
  private final TenantStatusChangeRepository tenantStatusChangeRepository;
  private final TaxRepository taxRepository;
  private final FemmeTimeProperties timeProperties;

  public TenantAdminService(
      TenantRepository tenantRepository,
      TierRepository tierRepository,
      TenantTierChangeRepository tenantTierChangeRepository,
      TenantStatusChangeRepository tenantStatusChangeRepository,
      TaxRepository taxRepository,
      FemmeTimeProperties timeProperties) {
    this.tenantRepository = tenantRepository;
    this.tierRepository = tierRepository;
    this.tenantTierChangeRepository = tenantTierChangeRepository;
    this.tenantStatusChangeRepository = tenantStatusChangeRepository;
    this.taxRepository = taxRepository;
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
    seedDefaultTaxes(tenant);
    return toResponse(tenant);
  }

  // HU-58: every tenant needs Paraguay's three standard IVA rates to categorize services/invoices
  // at all (see TaxController) — these are fixed, legally-defined rates identical for every
  // business in the country, not tenant-chosen "business data" (unlike clients/services/
  // professionals, which HU-37 AC-5/AC-7 verifies stays empty for a new tenant). Before this, only
  // the now-removed DemoTenantCatalogSeedService ever created them, and only for a single
  // hardcoded demo tenant via the e2e/dev-only seed-reset endpoint — a tenant created through the
  // real Platform Admin API had no way to get taxes at all. Seeding them here, for every tenant, at
  // creation time is what actually removes that hardcoded-to-one-tenant dependency.
  private void seedDefaultTaxes(Tenant tenant) {
    Tax iva10 = new Tax();
    iva10.setTenant(tenant);
    iva10.setName("IVA 10%");
    iva10.setRate(new BigDecimal("10.00"));
    iva10.setActive(true);
    taxRepository.save(iva10);

    Tax iva5 = new Tax();
    iva5.setTenant(tenant);
    iva5.setName("IVA 5%");
    iva5.setRate(new BigDecimal("5.00"));
    iva5.setActive(true);
    taxRepository.save(iva5);

    Tax exento = new Tax();
    exento.setTenant(tenant);
    exento.setName("Exento");
    exento.setRate(BigDecimal.ZERO);
    exento.setActive(true);
    taxRepository.save(exento);
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
   * HU-40 AC-1/AC-4: Platform Admin flips a tenant's status between {@code ACTIVE} and {@code
   * SUSPENDED}. Suspending only flips this flag — no business data (clients, services,
   * professionals, comprobantes) is touched (AC-5), and login enforcement lives in {@code
   * AuthService#login} / {@code JwtAuthenticationFilter}, not here. A no-op (status unchanged)
   * skips the audit write, same convention as {@link #update} skipping a tier-change row when the
   * tier didn't actually change.
   */
  @Transactional
  public TenantResponse updateStatus(
      Long id, TenantStatusUpdateRequest request, long changedByUserId, String changedByEmail) {
    Tenant tenant =
        tenantRepository
            .findById(id)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND"));

    TenantStatus newStatus;
    try {
      newStatus = TenantStatus.valueOf(request.status() == null ? "" : request.status().trim());
    } catch (IllegalArgumentException ex) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "TENANT_STATUS_INVALID");
    }

    TenantStatus previousStatus = tenant.getStatus();
    if (previousStatus != newStatus) {
      tenant.setStatus(newStatus);
      tenantRepository.save(tenant);
      recordStatusChange(
          tenant.getId(), previousStatus, newStatus, changedByUserId, changedByEmail);
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

  /**
   * HU-40 AC-1/AC-4: same "single last result" upsert as {@link #recordTierChange}, but for status
   * transitions.
   */
  private void recordStatusChange(
      Long tenantId,
      TenantStatus previousStatus,
      TenantStatus newStatus,
      long changedByUserId,
      String changedByEmail) {
    TenantStatusChange change =
        tenantStatusChangeRepository
            .findByTenantId(tenantId)
            .orElseGet(
                () -> {
                  TenantStatusChange c = new TenantStatusChange();
                  c.setTenantId(tenantId);
                  return c;
                });
    change.setPreviousStatus(previousStatus.name());
    change.setNewStatus(newStatus.name());
    change.setChangedAt(LocalDateTime.now(timeProperties.zoneId()));
    change.setChangedByUserId(changedByUserId);
    change.setChangedByEmail(changedByEmail);
    tenantStatusChangeRepository.save(change);
  }

  private TenantResponse toResponse(Tenant tenant) {
    Tier tier = tenant.getTier();
    TenantTierChangeResponse lastTierChange =
        tenantTierChangeRepository
            .findByTenantId(tenant.getId())
            .map(this::toTierChangeResponse)
            .orElse(null);
    TenantStatusChangeResponse lastStatusChange =
        tenantStatusChangeRepository
            .findByTenantId(tenant.getId())
            .map(this::toStatusChangeResponse)
            .orElse(null);
    return new TenantResponse(
        tenant.getId(),
        tenant.getName(),
        tenant.getDomain(),
        tier != null ? tier.getId() : null,
        tier != null ? tier.getName() : null,
        tenant.getStatus().name(),
        lastTierChange,
        lastStatusChange);
  }

  private TenantTierChangeResponse toTierChangeResponse(TenantTierChange change) {
    return new TenantTierChangeResponse(
        change.getChangedAt().atZone(timeProperties.zoneId()).toInstant(),
        change.getChangedByEmail(),
        change.getPreviousTierName(),
        change.getNewTierName());
  }

  private TenantStatusChangeResponse toStatusChangeResponse(TenantStatusChange change) {
    return new TenantStatusChangeResponse(
        change.getChangedAt().atZone(timeProperties.zoneId()).toInstant(),
        change.getChangedByEmail(),
        change.getPreviousStatus(),
        change.getNewStatus());
  }
}
