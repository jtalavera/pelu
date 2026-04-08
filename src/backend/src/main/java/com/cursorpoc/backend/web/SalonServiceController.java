package com.cursorpoc.backend.web;

import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.ServiceCatalogService;
import com.cursorpoc.backend.web.dto.ServiceResponse;
import com.cursorpoc.backend.web.dto.ServiceUpsertRequest;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/services")
public class SalonServiceController {

  private final ServiceCatalogService serviceCatalogService;

  public SalonServiceController(ServiceCatalogService serviceCatalogService) {
    this.serviceCatalogService = serviceCatalogService;
  }

  @GetMapping
  public List<ServiceResponse> list(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @RequestParam(name = "categoryId", required = false) Long categoryId,
      @RequestParam(name = "q", required = false) String q) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Unauthorized");
    }
    return serviceCatalogService.listServices(
        principal.getTenantId(), Optional.ofNullable(categoryId), q);
  }

  @PostMapping
  public ServiceResponse create(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @Valid @RequestBody ServiceUpsertRequest request) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Unauthorized");
    }
    return serviceCatalogService.createService(principal.getTenantId(), request);
  }

  @PutMapping("/{id}")
  public ServiceResponse update(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("id") long id,
      @Valid @RequestBody ServiceUpsertRequest request) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Unauthorized");
    }
    return serviceCatalogService.updateService(principal.getTenantId(), id, request);
  }

  @PostMapping("/{id}/deactivate")
  public ServiceResponse deactivate(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable("id") long id) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Unauthorized");
    }
    return serviceCatalogService.deactivateService(principal.getTenantId(), id);
  }
}
