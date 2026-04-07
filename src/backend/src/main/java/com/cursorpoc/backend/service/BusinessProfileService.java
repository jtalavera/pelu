package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.BusinessProfile;
import com.cursorpoc.backend.domain.Tenant;
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

  @Transactional
  public BusinessProfileResponse update(long tenantId, BusinessProfileUpdateRequest request) {
    BusinessProfile bp = loadOrThrow(tenantId);
    String ruc = blankToNull(request.ruc());
    if (ruc != null && !ParaguayRucValidator.isValid(ruc)) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "Invalid RUC format or check digit");
    }
    bp.setBusinessName(request.businessName().trim());
    bp.setRuc(ruc);
    bp.setAddress(blankToNull(request.address()));
    bp.setPhone(blankToNull(request.phone()));
    bp.setContactEmail(blankToNull(request.contactEmail()));
    bp.setLogoDataUrl(request.logoDataUrl());
    return toDto(bp);
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
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Tenant not found"));
    BusinessProfile bp = new BusinessProfile();
    bp.setTenant(tenant);
    bp.setBusinessName(tenant.getName());
    businessProfileRepository.save(bp);
    return bp;
  }

  private static BusinessProfileResponse toDto(BusinessProfile bp) {
    return new BusinessProfileResponse(
        bp.getBusinessName(),
        bp.getRuc(),
        bp.getAddress(),
        bp.getPhone(),
        bp.getContactEmail(),
        bp.getLogoDataUrl());
  }

  private static String blankToNull(String s) {
    if (s == null) {
      return null;
    }
    String t = s.trim();
    return t.isEmpty() ? null : t;
  }
}
