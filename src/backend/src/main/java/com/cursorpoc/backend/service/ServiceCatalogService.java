package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.ServiceCategory;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.repository.ServiceCategoryRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.ServiceCategoryResponse;
import com.cursorpoc.backend.web.dto.ServiceCategoryUpsertRequest;
import com.cursorpoc.backend.web.dto.ServiceResponse;
import com.cursorpoc.backend.web.dto.ServiceUpsertRequest;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class ServiceCatalogService {

  private final TenantRepository tenantRepository;
  private final ServiceCategoryRepository serviceCategoryRepository;
  private final SalonServiceRepository salonServiceRepository;

  public ServiceCatalogService(
      TenantRepository tenantRepository,
      ServiceCategoryRepository serviceCategoryRepository,
      SalonServiceRepository salonServiceRepository) {
    this.tenantRepository = tenantRepository;
    this.serviceCategoryRepository = serviceCategoryRepository;
    this.salonServiceRepository = salonServiceRepository;
  }

  public List<ServiceCategoryResponse> listCategories(long tenantId, Boolean active) {
    return serviceCategoryRepository.findByTenant_IdOrderByNameAsc(tenantId).stream()
        .filter(c -> active == null || c.isActive() == active)
        .map(ServiceCatalogService::toCategoryResponse)
        .toList();
  }

  @Transactional
  public ServiceCategoryResponse createCategory(long tenantId, ServiceCategoryUpsertRequest request) {
    Tenant tenant = loadTenantOrThrow(tenantId);
    ServiceCategory c = new ServiceCategory();
    c.setTenant(tenant);
    c.setName(request.name().trim());
    c.setActive(true);
    serviceCategoryRepository.save(c);
    return toCategoryResponse(c);
  }

  @Transactional
  public ServiceCategoryResponse updateCategory(
      long tenantId, long categoryId, ServiceCategoryUpsertRequest request) {
    ServiceCategory c = loadCategoryOrThrow(tenantId, categoryId);
    c.setName(request.name().trim());
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

  public List<ServiceResponse> listServices(long tenantId, Optional<Long> categoryId, String q) {
    String qNorm = q == null ? "" : q.trim();
    String qLower = qNorm.toLowerCase(Locale.ROOT);

    return salonServiceRepository.findByTenant_IdOrderByNameAsc(tenantId).stream()
        .filter(s -> categoryId.isEmpty() || Objects.equals(s.getCategory().getId(), categoryId.get()))
        .filter(
            s ->
                qLower.isEmpty()
                    || s.getName().toLowerCase(Locale.ROOT).contains(qLower)
                    || s.getCategory().getName().toLowerCase(Locale.ROOT).contains(qLower))
        .sorted(
            Comparator.comparing((SalonService s) -> s.getCategory().getName(), String.CASE_INSENSITIVE_ORDER)
                .thenComparing(SalonService::getName, String.CASE_INSENSITIVE_ORDER))
        .map(ServiceCatalogService::toServiceResponse)
        .toList();
  }

  @Transactional
  public ServiceResponse createService(long tenantId, ServiceUpsertRequest request) {
    Tenant tenant = loadTenantOrThrow(tenantId);
    ServiceCategory category = loadCategoryOrThrow(tenantId, request.categoryId());
    if (!category.isActive()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Category is inactive");
    }
    SalonService s = new SalonService();
    s.setTenant(tenant);
    s.setCategory(category);
    s.setName(request.name().trim());
    s.setPriceMinor(request.priceMinor());
    s.setDurationMinutes(request.durationMinutes());
    s.setActive(true);
    salonServiceRepository.save(s);
    return toServiceResponse(s);
  }

  @Transactional
  public ServiceResponse updateService(long tenantId, long serviceId, ServiceUpsertRequest request) {
    SalonService s = loadServiceOrThrow(tenantId, serviceId);
    ServiceCategory category = loadCategoryOrThrow(tenantId, request.categoryId());
    if (!category.isActive()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Category is inactive");
    }
    s.setCategory(category);
    s.setName(request.name().trim());
    s.setPriceMinor(request.priceMinor());
    s.setDurationMinutes(request.durationMinutes());
    salonServiceRepository.save(s);
    return toServiceResponse(s);
  }

  @Transactional
  public ServiceResponse deactivateService(long tenantId, long serviceId) {
    SalonService s = loadServiceOrThrow(tenantId, serviceId);
    s.setActive(false);
    salonServiceRepository.save(s);
    return toServiceResponse(s);
  }

  private Tenant loadTenantOrThrow(long tenantId) {
    return tenantRepository
        .findById(tenantId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Tenant not found"));
  }

  private ServiceCategory loadCategoryOrThrow(long tenantId, long categoryId) {
    return serviceCategoryRepository
        .findByIdAndTenant_Id(categoryId, tenantId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Category not found"));
  }

  private SalonService loadServiceOrThrow(long tenantId, long serviceId) {
    return salonServiceRepository
        .findByIdAndTenant_Id(serviceId, tenantId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Service not found"));
  }

  private static ServiceCategoryResponse toCategoryResponse(ServiceCategory c) {
    return new ServiceCategoryResponse(c.getId(), c.getName(), c.isActive());
  }

  private static ServiceResponse toServiceResponse(SalonService s) {
    return new ServiceResponse(
        s.getId(),
        s.getCategory().getId(),
        s.getCategory().getName(),
        s.getName(),
        s.getPriceMinor(),
        s.getDurationMinutes(),
        s.isActive());
  }
}

