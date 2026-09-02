package com.cursorpoc.backend.web;

import com.cursorpoc.backend.config.SifenConnectionProperties;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.web.dto.SifenEnvironmentResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Exposes the SIFEN connection environment ({@code TEST}/{@code PRODUCTION}) the deployment is
 * configured against (HU-05 AC-04 — configuration-only via {@code FEMME_SIFEN_ENVIRONMENT}). The
 * frontend uses it to decide whether to offer the "production-style" sample KuDE download, which
 * only makes sense while running against the test environment.
 */
@RestController
@RequestMapping("/api/sifen/environment")
public class SifenEnvironmentController {

  private static final Logger log = LoggerFactory.getLogger(SifenEnvironmentController.class);

  private final SifenConnectionProperties connectionProperties;

  public SifenEnvironmentController(SifenConnectionProperties connectionProperties) {
    this.connectionProperties = connectionProperties;
  }

  @GetMapping
  public SifenEnvironmentResponse get(@AuthenticationPrincipal FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    long tenantId = principal.getTenantId();
    log.info("GET /api/sifen/environment method=GET tenantId={}", tenantId);
    String environment = connectionProperties.activeEnvironment().name();
    log.info(
        "GET /api/sifen/environment tenantId={} status=200 environment={}", tenantId, environment);
    return new SifenEnvironmentResponse(environment);
  }
}
