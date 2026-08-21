package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.Tier;
import com.cursorpoc.backend.domain.enums.TenantStatus;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.repository.TierRepository;
import com.cursorpoc.backend.web.dto.PageResponse;
import com.cursorpoc.backend.web.dto.TenantCreateRequest;
import com.cursorpoc.backend.web.dto.TenantResponse;
import com.cursorpoc.backend.web.dto.TierOptionResponse;
import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-37 (Épica B — Gestión de Tenants): Platform Admin creates and lists tenants. HU-39 will extend
 * {@link #listPaged} with search/filtering; this only needs the plain paged listing so a
 * freshly-created tenant is provably visible (AC-6).
 */
@Service
public class TenantAdminService {

  private final TenantRepository tenantRepository;
  private final TierRepository tierRepository;

  public TenantAdminService(TenantRepository tenantRepository, TierRepository tierRepository) {
    this.tenantRepository = tenantRepository;
    this.tierRepository = tierRepository;
  }

  @Transactional(readOnly = true)
  public PageResponse<TenantResponse> listPaged(int page, int size) {
    PageRequest pageable =
        PageRequest.of(
            Math.max(0, page), Math.max(1, Math.min(size, 200)), Sort.by("id").descending());
    Page<Tenant> result = tenantRepository.findAll(pageable);
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

  private TenantResponse toResponse(Tenant tenant) {
    Tier tier = tenant.getTier();
    return new TenantResponse(
        tenant.getId(),
        tenant.getName(),
        tenant.getDomain(),
        tier != null ? tier.getId() : null,
        tier != null ? tier.getName() : null,
        tenant.getStatus().name());
  }
}
