package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.ServiceCategory;
import com.cursorpoc.backend.domain.Tax;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.ServiceKind;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.repository.ServiceCategoryRepository;
import com.cursorpoc.backend.repository.TaxRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.stock.CatalogStockEvent;
import com.cursorpoc.backend.web.dto.PageResponse;
import com.cursorpoc.backend.web.dto.ServiceCategoryResponse;
import com.cursorpoc.backend.web.dto.ServiceCategoryUpsertRequest;
import com.cursorpoc.backend.web.dto.ServiceResponse;
import com.cursorpoc.backend.web.dto.ServiceUpsertRequest;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.ApplicationEventPublisherAware;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class ServiceCatalogService implements ApplicationEventPublisherAware {

  /**
   * Stock integration (HU-62): product changes publish {@code CatalogStockEvent}s. Defaults to a
   * no-op so plain unit tests that construct this service directly need no publisher.
   */
  private ApplicationEventPublisher events = event -> {};

  @Override
  public void setApplicationEventPublisher(ApplicationEventPublisher applicationEventPublisher) {
    this.events = applicationEventPublisher;
  }

  private static final Set<String> ALLOWED_CATEGORY_ACCENTS =
      Set.of(
          "rose", "coral", "fuchsia", "violet", "indigo", "sky", "teal", "lime", "amber", "mauve",
          "success", "warning", "danger", "stone");

  /**
   * Issue #95: items from this category always sort first in the invoice-form service picker, both
   * on initial load and search, regardless of alphabetical order.
   */
  private static final String PRIORITY_CATEGORY_NAME = "Servicios profesionales";

  private final TenantRepository tenantRepository;
  private final ServiceCategoryRepository serviceCategoryRepository;
  private final SalonServiceRepository salonServiceRepository;
  private final TaxRepository taxRepository;

  public ServiceCatalogService(
      TenantRepository tenantRepository,
      ServiceCategoryRepository serviceCategoryRepository,
      SalonServiceRepository salonServiceRepository,
      TaxRepository taxRepository) {
    this.tenantRepository = tenantRepository;
    this.serviceCategoryRepository = serviceCategoryRepository;
    this.salonServiceRepository = salonServiceRepository;
    this.taxRepository = taxRepository;
  }

  public List<ServiceCategoryResponse> listCategories(long tenantId, Boolean active) {
    return listCategories(tenantId, active, null);
  }

  /** Catalog split: optionally restricted to the categories of one kind (SERVICE / PRODUCT). */
  public List<ServiceCategoryResponse> listCategories(long tenantId, Boolean active, String kind) {
    ServiceKind kindFilter = kind == null || kind.isBlank() ? null : parseKind(kind);
    return serviceCategoryRepository.findByTenant_IdOrderByNameAsc(tenantId).stream()
        .filter(c -> active == null || c.isActive() == active)
        .filter(c -> kindFilter == null || c.getKind() == kindFilter)
        .map(ServiceCatalogService::toCategoryResponse)
        .toList();
  }

  @Transactional
  public ServiceCategoryResponse createCategory(
      long tenantId, ServiceCategoryUpsertRequest request) {
    Tenant tenant = loadTenantOrThrow(tenantId);
    ServiceCategory c = new ServiceCategory();
    c.setTenant(tenant);
    c.setName(request.name().trim());
    c.setActive(true);
    c.setAccentKey(normalizeAccent(request.accentKey()));
    c.setKind(parseKind(request.kind()));
    serviceCategoryRepository.save(c);
    return toCategoryResponse(c);
  }

  @Transactional
  public ServiceCategoryResponse updateCategory(
      long tenantId, long categoryId, ServiceCategoryUpsertRequest request) {
    ServiceCategory c = loadCategoryOrThrow(tenantId, categoryId);
    if (request.kind() != null
        && !request.kind().isBlank()
        && parseKind(request.kind()) != c.getKind()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "CATEGORY_KIND_IMMUTABLE");
    }
    c.setName(request.name().trim());
    if (request.accentKey() != null) {
      c.setAccentKey(normalizeAccent(request.accentKey()));
    }
    serviceCategoryRepository.save(c);
    return toCategoryResponse(c);
  }

  @Transactional
  public ServiceCategoryResponse deactivateCategory(long tenantId, long categoryId) {
    ServiceCategory c = loadCategoryOrThrow(tenantId, categoryId);
    c.setActive(false);
    serviceCategoryRepository.save(c);
    return toCategoryResponse(c);
  }

  @Transactional
  public ServiceCategoryResponse activateCategory(long tenantId, long categoryId) {
    ServiceCategory c = loadCategoryOrThrow(tenantId, categoryId);
    c.setActive(true);
    serviceCategoryRepository.save(c);
    return toCategoryResponse(c);
  }

  public List<ServiceResponse> listServices(long tenantId, Optional<Long> categoryId, String q) {
    return listServices(tenantId, categoryId, q, null);
  }

  /** Catalog split: same as above, optionally restricted to one kind (SERVICE / PRODUCT). */
  public List<ServiceResponse> listServices(
      long tenantId, Optional<Long> categoryId, String q, String kind) {
    ServiceKind kindFilter = kind == null || kind.isBlank() ? null : parseKind(kind);
    String qNorm = q == null ? "" : q.trim();
    String qLower = qNorm.toLowerCase(Locale.ROOT);

    return salonServiceRepository.findByTenant_IdOrderByNameAsc(tenantId).stream()
        .filter(s -> kindFilter == null || s.getKind() == kindFilter)
        .filter(
            s -> categoryId.isEmpty() || Objects.equals(s.getCategory().getId(), categoryId.get()))
        .filter(
            s ->
                qLower.isEmpty()
                    || s.getName().toLowerCase(Locale.ROOT).contains(qLower)
                    || s.getCategory().getName().toLowerCase(Locale.ROOT).contains(qLower))
        .sorted(
            Comparator.comparing(
                    (SalonService s) ->
                        !PRIORITY_CATEGORY_NAME.equalsIgnoreCase(s.getCategory().getName()))
                .thenComparing(
                    (SalonService s) -> s.getCategory().getName(), String.CASE_INSENSITIVE_ORDER)
                .thenComparing(SalonService::getName, String.CASE_INSENSITIVE_ORDER))
        .map(ServiceCatalogService::toServiceResponse)
        .toList();
  }

  @Transactional(readOnly = true)
  public PageResponse<ServiceResponse> listServicesPaged(
      long tenantId, Optional<Long> categoryId, String q, Boolean active, int page, int size) {
    return listServicesPaged(tenantId, categoryId, q, active, null, page, size);
  }

  /** HU-59: same as above, optionally filtered by kind (SERVICE / PRODUCT). */
  @Transactional(readOnly = true)
  public PageResponse<ServiceResponse> listServicesPaged(
      long tenantId,
      Optional<Long> categoryId,
      String q,
      Boolean active,
      String kind,
      int page,
      int size) {
    String qTrimmed = (q != null && !q.isBlank()) ? q.trim() : null;
    ServiceKind kindFilter = kind == null || kind.isBlank() ? null : parseKind(kind);
    PageRequest pageable = PageRequest.of(page, Math.max(1, Math.min(size, 200)));
    Page<SalonService> result =
        salonServiceRepository.findByTenantFilteredPaged(
            tenantId, categoryId.orElse(null), active, kindFilter, qTrimmed, pageable);
    List<ServiceResponse> content =
        result.getContent().stream()
            .map(ServiceCatalogService::toServiceResponse)
            .collect(Collectors.toList());
    return new PageResponse<>(
        content,
        result.getNumber(),
        result.getSize(),
        result.getTotalElements(),
        result.getTotalPages());
  }

  @Transactional
  public ServiceResponse createService(long tenantId, ServiceUpsertRequest request) {
    Tenant tenant = loadTenantOrThrow(tenantId);
    ServiceCategory category = loadCategoryOrThrow(tenantId, request.categoryId());
    if (!category.isActive()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "CATEGORY_INACTIVE");
    }
    Tax tax = request.taxId() != null ? loadTaxOrThrow(tenantId, request.taxId()) : null;
    ServiceKind kind = resolveItemKind(request.kind(), category, null);
    SalonService s = new SalonService();
    s.setTenant(tenant);
    s.setCategory(category);
    s.setTax(tax);
    s.setName(request.name().trim());
    s.setPriceMinor(request.priceMinor());
    s.setDurationMinutes(request.durationMinutes());
    s.setKind(kind);
    s.setSku(normalizeSku(request.sku()));
    s.setActive(true);
    salonServiceRepository.save(s);
    events.publishEvent(CatalogStockEvent.itemChanged(s, false));
    return toServiceResponse(s);
  }

  @Transactional
  public ServiceResponse updateService(
      long tenantId, long serviceId, ServiceUpsertRequest request) {
    SalonService s = loadServiceOrThrow(tenantId, serviceId);
    ServiceCategory category = loadCategoryOrThrow(tenantId, request.categoryId());
    if (!category.isActive()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "CATEGORY_INACTIVE");
    }
    Tax tax = request.taxId() != null ? loadTaxOrThrow(tenantId, request.taxId()) : null;
    ServiceKind kind = resolveItemKind(request.kind(), category, s.getKind());
    s.setCategory(category);
    s.setTax(tax);
    s.setName(request.name().trim());
    s.setPriceMinor(request.priceMinor());
    s.setDurationMinutes(request.durationMinutes());
    boolean wasProduct = s.isProduct();
    s.setKind(kind);
    s.setSku(normalizeSku(request.sku()));
    salonServiceRepository.save(s);
    events.publishEvent(CatalogStockEvent.itemChanged(s, wasProduct));
    return toServiceResponse(s);
  }

  @Transactional
  public ServiceResponse deactivateService(long tenantId, long serviceId) {
    SalonService s = loadServiceOrThrow(tenantId, serviceId);
    s.setActive(false);
    salonServiceRepository.save(s);
    events.publishEvent(CatalogStockEvent.itemChanged(s, s.isProduct()));
    return toServiceResponse(s);
  }

  @Transactional
  public ServiceResponse activateService(long tenantId, long serviceId) {
    SalonService s = loadServiceOrThrow(tenantId, serviceId);
    ServiceCategory category = s.getCategory();
    if (!category.isActive()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "CATEGORY_INACTIVE");
    }
    s.setActive(true);
    salonServiceRepository.save(s);
    events.publishEvent(CatalogStockEvent.itemChanged(s, s.isProduct()));
    return toServiceResponse(s);
  }

  /**
   * Catalog split: an item's kind is the kind of its category. An explicit {@code requested} kind
   * (or, when none is sent, the item's {@code current} kind) must match; a new item without kind
   * simply inherits the category's.
   */
  private static ServiceKind resolveItemKind(
      String requested, ServiceCategory category, ServiceKind current) {
    ServiceKind kind;
    if (requested != null && !requested.isBlank()) {
      kind = parseKind(requested);
    } else if (current != null) {
      kind = current;
    } else {
      kind = category.getKind();
    }
    if (kind != category.getKind()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "CATEGORY_KIND_MISMATCH");
    }
    return kind;
  }

  /** HU-59: null/blank → SERVICE; anything but SERVICE/PRODUCT → 400 INVALID_SERVICE_KIND. */
  static ServiceKind parseKind(String raw) {
    if (raw == null || raw.isBlank()) {
      return ServiceKind.SERVICE;
    }
    try {
      return ServiceKind.valueOf(raw.trim().toUpperCase(Locale.ROOT));
    } catch (IllegalArgumentException e) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_SERVICE_KIND");
    }
  }

  private static String normalizeSku(String raw) {
    if (raw == null || raw.isBlank()) {
      return null;
    }
    String sku = raw.trim();
    if (sku.length() > 64) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_SKU");
    }
    return sku;
  }

  private Tenant loadTenantOrThrow(long tenantId) {
    return tenantRepository
        .findById(tenantId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND"));
  }

  private ServiceCategory loadCategoryOrThrow(long tenantId, long categoryId) {
    return serviceCategoryRepository
        .findByIdAndTenant_Id(categoryId, tenantId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "CATEGORY_NOT_FOUND"));
  }

  private SalonService loadServiceOrThrow(long tenantId, long serviceId) {
    return salonServiceRepository
        .findByIdAndTenant_Id(serviceId, tenantId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "SERVICE_NOT_FOUND"));
  }

  private Tax loadTaxOrThrow(long tenantId, long taxId) {
    return taxRepository
        .findByIdAndTenant_Id(taxId, tenantId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TAX_NOT_FOUND"));
  }

  private static ServiceCategoryResponse toCategoryResponse(ServiceCategory c) {
    return new ServiceCategoryResponse(
        c.getId(),
        c.getName(),
        c.isActive(),
        c.getAccentKey(),
        c.getKind() != null ? c.getKind().name() : ServiceKind.SERVICE.name());
  }

  private static ServiceResponse toServiceResponse(SalonService s) {
    Tax tax = s.getTax();
    return new ServiceResponse(
        s.getId(),
        s.getCategory().getId(),
        s.getCategory().getName(),
        s.getCategory().getAccentKey(),
        tax != null ? tax.getId() : null,
        tax != null ? tax.getName() : null,
        tax != null ? tax.getRate() : null,
        s.getName(),
        s.getPriceMinor(),
        s.getDurationMinutes(),
        s.isActive(),
        s.getKind() != null ? s.getKind().name() : ServiceKind.SERVICE.name(),
        s.getSku());
  }

  private static String normalizeAccent(String raw) {
    if (raw == null || raw.isBlank()) {
      return "stone";
    }
    String s = raw.trim().toLowerCase(Locale.ROOT);
    if (!ALLOWED_CATEGORY_ACCENTS.contains(s)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_CATEGORY_ACCENT");
    }
    return s;
  }
}
