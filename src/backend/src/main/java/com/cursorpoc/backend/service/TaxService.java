package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.Tax;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.repository.TaxRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.TaxResponse;
import com.cursorpoc.backend.web.dto.TaxUpsertRequest;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class TaxService {

  private final TenantRepository tenantRepository;
  private final TaxRepository taxRepository;

  public TaxService(TenantRepository tenantRepository, TaxRepository taxRepository) {
    this.tenantRepository = tenantRepository;
    this.taxRepository = taxRepository;
  }

  public List<TaxResponse> listTaxes(long tenantId) {
    return taxRepository.findByTenant_IdOrderByNameAsc(tenantId).stream()
        .map(TaxService::toResponse)
        .toList();
  }

  public List<TaxResponse> listActiveTaxes(long tenantId) {
    return taxRepository.findByTenant_IdAndActiveOrderByNameAsc(tenantId, true).stream()
        .map(TaxService::toResponse)
        .toList();
  }

  @Transactional
  public TaxResponse createTax(long tenantId, TaxUpsertRequest request) {
    Tenant tenant = loadTenantOrThrow(tenantId);
    Tax tax = new Tax();
    tax.setTenant(tenant);
    tax.setName(request.name().trim());
    tax.setRate(request.rate());
    tax.setActive(true);
    taxRepository.save(tax);
    return toResponse(tax);
  }

  @Transactional
  public TaxResponse updateTax(long tenantId, long taxId, TaxUpsertRequest request) {
    Tax tax = loadTaxOrThrow(tenantId, taxId);
    tax.setName(request.name().trim());
    tax.setRate(request.rate());
    taxRepository.save(tax);
    return toResponse(tax);
  }

  @Transactional
  public TaxResponse deactivateTax(long tenantId, long taxId) {
    Tax tax = loadTaxOrThrow(tenantId, taxId);
    tax.setActive(false);
    taxRepository.save(tax);
    return toResponse(tax);
  }

  @Transactional
  public TaxResponse activateTax(long tenantId, long taxId) {
    Tax tax = loadTaxOrThrow(tenantId, taxId);
    tax.setActive(true);
    taxRepository.save(tax);
    return toResponse(tax);
  }

  private Tenant loadTenantOrThrow(long tenantId) {
    return tenantRepository
        .findById(tenantId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND"));
  }

  private Tax loadTaxOrThrow(long tenantId, long taxId) {
    return taxRepository
        .findByIdAndTenant_Id(taxId, tenantId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TAX_NOT_FOUND"));
  }

  private static TaxResponse toResponse(Tax t) {
    return new TaxResponse(t.getId(), t.getName(), t.getRate(), t.isActive());
  }
}
