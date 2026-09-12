package com.cursorpoc.backend.web;

import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.ServiceCatalogService;
import com.cursorpoc.backend.service.ServicePriceListPdfService;
import com.cursorpoc.backend.web.dto.PageResponse;
import com.cursorpoc.backend.web.dto.ServiceResponse;
import com.cursorpoc.backend.web.dto.ServiceUpsertRequest;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
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

  private static final Logger log = LoggerFactory.getLogger(SalonServiceController.class);

  private final ServiceCatalogService serviceCatalogService;
  private final ServicePriceListPdfService priceListPdfService;

  public SalonServiceController(
      ServiceCatalogService serviceCatalogService, ServicePriceListPdfService priceListPdfService) {
    this.serviceCatalogService = serviceCatalogService;
    this.priceListPdfService = priceListPdfService;
  }

  @GetMapping
  public List<ServiceResponse> list(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @RequestParam(name = "categoryId", required = false) Long categoryId,
      @RequestParam(name = "q", required = false) String q) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    return serviceCatalogService.listServices(
        principal.getTenantId(), Optional.ofNullable(categoryId), q);
  }

  @GetMapping("/page")
  public PageResponse<ServiceResponse> listPaged(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @RequestParam(name = "categoryId", required = false) Long categoryId,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(name = "active", required = false) Boolean active,
      @RequestParam(name = "page", defaultValue = "0") int page,
      @RequestParam(name = "size", defaultValue = "10") int size) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    log.info(
        "GET /api/services/page tenantId={} page={} size={}", principal.getTenantId(), page, size);
    try {
      PageResponse<ServiceResponse> response =
          serviceCatalogService.listServicesPaged(
              principal.getTenantId(), Optional.ofNullable(categoryId), q, active, page, size);
      log.info(
          "GET /api/services/page tenantId={} status=200 total={}",
          principal.getTenantId(),
          response.totalElements());
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "GET /api/services/page tenantId={} status={}",
          principal.getTenantId(),
          ex.getStatusCode().value());
      throw ex;
    }
  }

  /**
   * Issue #217: a shareable PDF price list with the tenant's active services (name + price) and the
   * business's fantasy name (falling back to its business name) as the document header.
   */
  @GetMapping(value = "/price-list/pdf", produces = MediaType.APPLICATION_PDF_VALUE)
  public ResponseEntity<byte[]> priceListPdf(
      @AuthenticationPrincipal FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    log.info("GET /api/services/price-list/pdf tenantId={}", principal.getTenantId());
    try {
      byte[] pdf = priceListPdfService.buildPriceListPdf(principal.getTenantId());
      log.info("GET /api/services/price-list/pdf tenantId={} status=200", principal.getTenantId());
      return ResponseEntity.ok()
          .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"lista-precios.pdf\"")
          .body(pdf);
    } catch (ResponseStatusException ex) {
      log.error(
          "GET /api/services/price-list/pdf tenantId={} status={}",
          principal.getTenantId(),
          ex.getStatusCode().value());
      throw ex;
    }
  }

  @PostMapping
  public ServiceResponse create(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @Valid @RequestBody ServiceUpsertRequest request) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    return serviceCatalogService.createService(principal.getTenantId(), request);
  }

  @PutMapping("/{id}")
  public ServiceResponse update(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("id") long id,
      @Valid @RequestBody ServiceUpsertRequest request) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    return serviceCatalogService.updateService(principal.getTenantId(), id, request);
  }

  @PostMapping("/{id}/deactivate")
  public ServiceResponse deactivate(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable("id") long id) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    return serviceCatalogService.deactivateService(principal.getTenantId(), id);
  }

  @PostMapping("/{id}/activate")
  public ServiceResponse activate(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable("id") long id) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    log.info("POST /api/services/{}/activate tenantId={}", id, principal.getTenantId());
    try {
      ServiceResponse response = serviceCatalogService.activateService(principal.getTenantId(), id);
      log.info(
          "POST /api/services/{}/activate tenantId={} status=200", id, principal.getTenantId());
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "POST /api/services/{}/activate tenantId={} status={}",
          id,
          principal.getTenantId(),
          ex.getStatusCode().value());
      throw ex;
    }
  }
}
