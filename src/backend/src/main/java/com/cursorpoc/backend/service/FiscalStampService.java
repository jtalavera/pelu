package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.FiscalStamp;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.repository.FiscalStampRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.FiscalStampCreateRequest;
import com.cursorpoc.backend.web.dto.FiscalStampResponse;
import com.cursorpoc.backend.web.dto.FiscalStampUpdateRequest;
import java.util.List;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class FiscalStampService {

  private final TenantRepository tenantRepository;
  private final FiscalStampRepository fiscalStampRepository;

  public FiscalStampService(
      TenantRepository tenantRepository, FiscalStampRepository fiscalStampRepository) {
    this.tenantRepository = tenantRepository;
    this.fiscalStampRepository = fiscalStampRepository;
  }

  @Transactional(readOnly = true)
  public List<FiscalStampResponse> list(long tenantId) {
    return fiscalStampRepository.findByTenant_IdOrderByIdAsc(tenantId).stream()
        .map(FiscalStampService::toDto)
        .collect(Collectors.toList());
  }

  @Transactional
  public FiscalStampResponse create(long tenantId, FiscalStampCreateRequest request) {
    Tenant tenant = loadTenant(tenantId);
    String stampDigits = validateStampNumberDigits(request.stampNumber());
    validateDateOrder(request.validFrom(), request.validUntil());
    validateRange(request.rangeFrom(), request.rangeTo());
    validateEmissionInRange(
        request.initialEmissionNumber(), request.rangeFrom(), request.rangeTo());

    FiscalStamp stamp = new FiscalStamp();
    stamp.setTenant(tenant);
    stamp.setStampNumber(stampDigits);
    stamp.setValidFrom(request.validFrom());
    stamp.setValidUntil(request.validUntil());
    stamp.setRangeFrom(request.rangeFrom());
    stamp.setRangeTo(request.rangeTo());
    stamp.setNextEmissionNumber(request.initialEmissionNumber());
    stamp.setActive(false);
    stamp.setLockedAfterInvoice(false);
    fiscalStampRepository.save(stamp);
    return toDto(stamp);
  }

  @Transactional
  public FiscalStampResponse update(long tenantId, long id, FiscalStampUpdateRequest request) {
    FiscalStamp stamp = loadForTenant(tenantId, id);
    if (stamp.isLockedAfterInvoice()) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "STAMP_LOCKED_AFTER_INVOICE");
    }
    validateDateOrder(request.validFrom(), request.validUntil());
    validateEmissionInRange(request.nextEmissionNumber(), stamp.getRangeFrom(), stamp.getRangeTo());
    stamp.setValidFrom(request.validFrom());
    stamp.setValidUntil(request.validUntil());
    stamp.setNextEmissionNumber(request.nextEmissionNumber());
    return toDto(stamp);
  }

  @Transactional
  public FiscalStampResponse activate(long tenantId, long id) {
    FiscalStamp stamp = loadForTenant(tenantId, id);
    List<FiscalStamp> all = fiscalStampRepository.findByTenant_IdOrderByIdAsc(tenantId);
    for (FiscalStamp s : all) {
      s.setActive(s.getId().equals(stamp.getId()));
    }
    return toDto(stamp);
  }

  @Transactional
  public FiscalStampResponse deactivate(long tenantId, long id) {
    FiscalStamp stamp = loadForTenant(tenantId, id);
    stamp.setActive(false);
    return toDto(stamp);
  }

  /**
   * Call when an invoice is issued (HU-14) so stamp number and range can no longer be edited.
   * Idempotent.
   */
  @Transactional
  public void markLockedAfterInvoice(long tenantId, long fiscalStampId) {
    FiscalStamp stamp = loadForTenant(tenantId, fiscalStampId);
    stamp.setLockedAfterInvoice(true);
  }

  private FiscalStamp loadForTenant(long tenantId, long id) {
    return fiscalStampRepository
        .findById(id)
        .filter(s -> s.getTenant().getId().equals(tenantId))
        .orElseThrow(
            () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "FISCAL_STAMP_NOT_FOUND"));
  }

  private Tenant loadTenant(long tenantId) {
    return tenantRepository
        .findById(tenantId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND"));
  }

  private static String validateStampNumberDigits(String raw) {
    String trimmed = raw == null ? "" : raw.trim();
    if (trimmed.isEmpty() || !trimmed.chars().allMatch(Character::isDigit)) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "STAMP_NUMBER_DIGITS_ONLY");
    }
    return trimmed;
  }

  private static void validateDateOrder(java.time.LocalDate from, java.time.LocalDate until) {
    if (!until.isAfter(from)) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "VALIDITY_END_BEFORE_START");
    }
  }

  private static void validateRange(int rangeFrom, int rangeTo) {
    if (rangeFrom > rangeTo) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_NUMBER_RANGE");
    }
  }

  private static void validateEmissionInRange(int emission, int rangeFrom, int rangeTo) {
    if (emission < rangeFrom || emission > rangeTo) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "EMISSION_OUT_OF_RANGE");
    }
  }

  private static FiscalStampResponse toDto(FiscalStamp s) {
    return new FiscalStampResponse(
        s.getId(),
        s.getStampNumber(),
        s.getValidFrom(),
        s.getValidUntil(),
        s.getRangeFrom(),
        s.getRangeTo(),
        s.getNextEmissionNumber(),
        s.isActive(),
        s.isLockedAfterInvoice());
  }
}
