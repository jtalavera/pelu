package com.cursorpoc.backend.web;

import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.SifenGeographicCatalogService;
import com.cursorpoc.backend.service.SifenGeographicLocality;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * SIFEN HU-02 AC-07: powers the department/city picker on the client form — search-as-you-type
 * against the official DNIT geographic catalog ({@link SifenGeographicCatalogService}).
 */
@RestController
@RequestMapping("/api/sifen/geographic-localities")
public class SifenGeographicCatalogController {

  private static final Logger log = LoggerFactory.getLogger(SifenGeographicCatalogController.class);

  private static final int SEARCH_LIMIT = 20;

  private final SifenGeographicCatalogService catalogService;

  public SifenGeographicCatalogController(SifenGeographicCatalogService catalogService) {
    this.catalogService = catalogService;
  }

  @GetMapping
  public List<SifenGeographicLocality> search(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @RequestParam(name = "q", required = false, defaultValue = "") String q) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    log.info("GET /api/sifen/geographic-localities tenantId={}", principal.getTenantId());
    List<SifenGeographicLocality> result = catalogService.search(q, SEARCH_LIMIT);
    log.info(
        "GET /api/sifen/geographic-localities tenantId={} status=200 results={}",
        principal.getTenantId(),
        result.size());
    return result;
  }
}
