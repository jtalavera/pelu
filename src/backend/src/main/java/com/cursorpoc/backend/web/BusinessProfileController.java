package com.cursorpoc.backend.web;

import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.BusinessProfileService;
import com.cursorpoc.backend.web.dto.BusinessProfileResponse;
import com.cursorpoc.backend.web.dto.BusinessProfileUpdateRequest;
import jakarta.validation.Valid;
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

  private final BusinessProfileService businessProfileService;

  public BusinessProfileController(BusinessProfileService businessProfileService) {
    this.businessProfileService = businessProfileService;
  }

  @GetMapping
  public BusinessProfileResponse get(@AuthenticationPrincipal FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Unauthorized");
    }
    return businessProfileService.get(principal.getTenantId());
  }

  @PutMapping
  public BusinessProfileResponse update(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @Valid @RequestBody BusinessProfileUpdateRequest request) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Unauthorized");
    }
    return businessProfileService.update(principal.getTenantId(), request);
  }
}
