package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.BusinessProfile;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.SifenTaxpayerType;
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.util.ParaguayRucValidator;
import com.cursorpoc.backend.web.dto.BusinessProfileResponse;
import com.cursorpoc.backend.web.dto.BusinessProfileUpdateRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class BusinessProfileService {

  private static final int MAX_LOGO_DATA_URL_CHARS = 2_500_000;

  private final TenantRepository tenantRepository;
  private final BusinessProfileRepository businessProfileRepository;

  public BusinessProfileService(
      TenantRepository tenantRepository, BusinessProfileRepository businessProfileRepository) {
    this.tenantRepository = tenantRepository;
    this.businessProfileRepository = businessProfileRepository;
  }

  @Transactional(readOnly = true)
  public BusinessProfileResponse get(long tenantId) {
    BusinessProfile bp = loadOrThrow(tenantId);
    return toDto(bp);
  }

  /**
   * A pure check with no side effect — unlike {@link #loadOrThrow}, it must NOT lazily create a
   * default profile: callers (e.g. {@code DashboardService}) may invoke this more than once within
   * the same read-only transaction, and a lazy-create there previously caused a {@code
   * NonUniqueObjectException} (the first call's unflushed insert isn't visible to the second call's
   * lookup, so it tried to persist a second entity for the same tenant id). A tenant with no
   * profile row yet simply isn't RUC-ready.
   */
  @Transactional(readOnly = true)
  public boolean isRucReadyForInvoicing(long tenantId) {
    return businessProfileRepository
        .findByTenantId(tenantId)
        .map(bp -> bp.getRuc() != null && ParaguayRucValidator.isValid(bp.getRuc()))
        .orElse(false);
  }

  @Transactional
  public BusinessProfileResponse update(long tenantId, BusinessProfileUpdateRequest request) {
    BusinessProfile bp = loadOrThrow(tenantId);
    String ruc = blankToNull(request.ruc());
    if (ruc != null && !ParaguayRucValidator.isValid(ruc)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_RUC_FORMAT");
    }
    bp.setBusinessName(request.businessName().trim());
    bp.setRuc(ruc);
    bp.setAddress(blankToNull(request.address()));
    bp.setPhone(blankToNull(request.phone()));
    bp.setContactEmail(blankToNull(request.contactEmail()));
    if (request.logoDataUrl() != null) {
      if (request.logoDataUrl().isBlank()) {
        bp.setLogoDataUrl(null);
      } else {
        validateLogoDataUrl(request.logoDataUrl());
        bp.setLogoDataUrl(request.logoDataUrl());
      }
    }
    bp.setTaxpayerType(parseTaxpayerType(request.taxpayerType()));
    bp.setEconomicActivityCode(blankToNull(request.economicActivityCode()));
    bp.setEconomicActivityDescription(blankToNull(request.economicActivityDescription()));
    bp.setSifenDepartmentCode(blankToNull(request.sifenDepartmentCode()));
    bp.setSifenDepartmentName(blankToNull(request.sifenDepartmentName()));
    bp.setSifenCityCode(blankToNull(request.sifenCityCode()));
    bp.setSifenCityName(blankToNull(request.sifenCityName()));
    bp.setSifenFantasyName(blankToNull(request.sifenFantasyName()));
    bp.setKudeFooterMessage(blankToNull(request.kudeFooterMessage()));
    return toDto(bp);
  }

  private static SifenTaxpayerType parseTaxpayerType(String raw) {
    String trimmed = blankToNull(raw);
    if (trimmed == null) {
      return null;
    }
    try {
      return SifenTaxpayerType.valueOf(trimmed);
    } catch (IllegalArgumentException e) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_TAXPAYER_TYPE");
    }
  }

  private BusinessProfile loadOrThrow(long tenantId) {
    return businessProfileRepository
        .findByTenantId(tenantId)
        .orElseGet(() -> createDefaultProfile(tenantId));
  }

  private BusinessProfile createDefaultProfile(long tenantId) {
    Tenant tenant =
        tenantRepository
            .findById(tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND"));
    BusinessProfile bp = new BusinessProfile();
    bp.setTenant(tenant);
    bp.setBusinessName(tenant.getName());
    businessProfileRepository.save(bp);
    return bp;
  }

  private static BusinessProfileResponse toDto(BusinessProfile bp) {
    String ruc = bp.getRuc();
    boolean rucValid = ruc != null && ParaguayRucValidator.isValid(ruc);
    return new BusinessProfileResponse(
        bp.getBusinessName(),
        ruc,
        bp.getAddress(),
        bp.getPhone(),
        bp.getContactEmail(),
        bp.getLogoDataUrl(),
        rucValid,
        bp.getTaxpayerType() != null ? bp.getTaxpayerType().name() : null,
        bp.getEconomicActivityCode(),
        bp.getEconomicActivityDescription(),
        bp.getSifenDepartmentCode(),
        bp.getSifenDepartmentName(),
        bp.getSifenCityCode(),
        bp.getSifenCityName(),
        bp.getSifenFantasyName(),
        bp.getKudeFooterMessage());
  }

  private static void validateLogoDataUrl(String dataUrl) {
    if (dataUrl.length() > MAX_LOGO_DATA_URL_CHARS) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "LOGO_TOO_LARGE");
    }
    if (!dataUrl.startsWith("data:image/")) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "LOGO_INVALID_FORMAT");
    }
  }

  private static String blankToNull(String s) {
    if (s == null) {
      return null;
    }
    String t = s.trim();
    return t.isEmpty() ? null : t;
  }
}
