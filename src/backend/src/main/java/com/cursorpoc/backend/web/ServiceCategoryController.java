package com.cursorpoc.backend.web;

import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.ServiceCatalogService;
import com.cursorpoc.backend.web.dto.ServiceCategoryResponse;
import com.cursorpoc.backend.web.dto.ServiceCategoryUpsertRequest;
import jakarta.validation.Valid;
import java.util.List;
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
@RequestMapping("/api/service-categories")
public class ServiceCategoryController {

  private final ServiceCatalogService serviceCatalogService;

  public ServiceCategoryController(ServiceCatalogService serviceCatalogService) {
    this.serviceCatalogService = serviceCatalogService;
  }

  @GetMapping
  public List<ServiceCategoryResponse> list(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @RequestParam(name = "active", required = false) Boolean active) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    return serviceCatalogService.listCategories(principal.getTenantId(), active);
  }

  @PostMapping
  public ServiceCategoryResponse create(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @Valid @RequestBody ServiceCategoryUpsertRequest request) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    return serviceCatalogService.createCategory(principal.getTenantId(), request);
  }

  @PutMapping("/{categoryId}")
  public ServiceCategoryResponse update(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable long categoryId,
      @Valid @RequestBody ServiceCategoryUpsertRequest request) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    return serviceCatalogService.updateCategory(principal.getTenantId(), categoryId, request);
  }

  @PostMapping("/{categoryId}/deactivate")
  public ServiceCategoryResponse deactivate(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable long categoryId) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    return serviceCatalogService.deactivateCategory(principal.getTenantId(), categoryId);
  }
}
