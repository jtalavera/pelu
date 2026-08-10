package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.BusinessProfileService;
import com.cursorpoc.backend.web.dto.BusinessProfileResponse;
import com.cursorpoc.backend.web.dto.BusinessProfileUpdateRequest;
import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/business-profile")
public class BusinessProfileController {

  private static final Logger log = LoggerFactory.getLogger(BusinessProfileController.class);

  private final BusinessProfileService businessProfileService;

  public BusinessProfileController(BusinessProfileService businessProfileService) {
    this.businessProfileService = businessProfileService;
  }

  @GetMapping
  public BusinessProfileResponse get(@AuthenticationPrincipal FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    long tenantId = principal.getTenantId();
    log.info("GET /api/business-profile method=GET tenantId={}", tenantId);
    BusinessProfileResponse out = businessProfileService.get(tenantId);
    log.info("GET /api/business-profile tenantId={} status=200", tenantId);
    return out;
  }

  @PutMapping
  public BusinessProfileResponse update(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @Valid @RequestBody BusinessProfileUpdateRequest request) {
    requireTenantAdmin(principal);
    long tenantId = principal.getTenantId();
    log.info("PUT /api/business-profile method=PUT tenantId={}", tenantId);
    try {
      BusinessProfileResponse out = businessProfileService.update(tenantId, request);
      log.info("PUT /api/business-profile tenantId={} status=200", tenantId);
      return out;
    } catch (ResponseStatusException e) {
      log.error("PUT /api/business-profile tenantId={} status={}", tenantId, e.getStatusCode());
      throw e;
    }
  }

  private static void requireTenantAdmin(FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    if (principal.getRole() != UserRole.ADMIN) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
  }
}
