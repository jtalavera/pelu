package com.cursorpoc.backend.web;

import com.cursorpoc.backend.service.BusinessProfileService;
import com.cursorpoc.backend.service.TenantContext;
import com.cursorpoc.backend.web.dto.BusinessProfileResponse;
import com.cursorpoc.backend.web.dto.BusinessProfileUpdateRequest;
import jakarta.validation.Valid;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(path = "/api/business-profile", produces = MediaType.APPLICATION_JSON_VALUE)
public class BusinessProfileController {

  private final BusinessProfileService businessProfileService;

  public BusinessProfileController(BusinessProfileService businessProfileService) {
    this.businessProfileService = businessProfileService;
  }

  @GetMapping
  public BusinessProfileResponse get() {
    return businessProfileService.get(TenantContext.requireTenantId());
  }

  @PutMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
  public BusinessProfileResponse update(@Valid @RequestBody BusinessProfileUpdateRequest request) {
    return businessProfileService.update(TenantContext.requireTenantId(), request);
  }
}
