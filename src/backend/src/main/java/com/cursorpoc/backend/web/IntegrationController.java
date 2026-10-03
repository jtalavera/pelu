package com.cursorpoc.backend.web;

import com.cursorpoc.backend.stock.IntegrationTokenService;
import com.cursorpoc.backend.stock.IntegrationTokenService.IntegrationPrincipal;
import com.cursorpoc.backend.stock.IntegrationTokenService.IssuedToken;
import com.cursorpoc.backend.stock.StockFeatureFlagPublisher;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Stock integration (HU-61): the inbound M2M surface control-stock uses — the only call from Stock
 * to pelu — to reconcile flags every 15 min (pull). {@code POST /oauth/token} is OAuth2 {@code
 * client_credentials} (form body, HTTP Basic, or JSON); {@code GET /feature-flags/resolved} needs
 * scope {@code flags:read} and answers the resolved {@code STOCK_*} flags per tenant with the same
 * monotonic version pelu pushes.
 */
@RestController
@RequestMapping("/api/integration")
public class IntegrationController {

  private static final Logger log = LoggerFactory.getLogger(IntegrationController.class);

  private static final int MAX_TENANTS = 200;

  private final IntegrationTokenService tokenService;
  private final StockFeatureFlagPublisher flagPublisher;

  public IntegrationController(
      IntegrationTokenService tokenService, StockFeatureFlagPublisher flagPublisher) {
    this.tokenService = tokenService;
    this.flagPublisher = flagPublisher;
  }

  @PostMapping(path = "/oauth/token", consumes = MediaType.APPLICATION_FORM_URLENCODED_VALUE)
  public Map<String, Object> tokenForm(
      @RequestParam MultiValueMap<String, String> form,
      @RequestHeader(name = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    return token(
        form.getFirst("grant_type"),
        form.getFirst("client_id"),
        form.getFirst("client_secret"),
        form.getFirst("scope"),
        authorization);
  }

  @PostMapping(path = "/oauth/token", consumes = MediaType.APPLICATION_JSON_VALUE)
  public Map<String, Object> tokenJson(
      @RequestBody Map<String, String> body,
      @RequestHeader(name = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
    return token(
        body.get("grant_type"),
        body.get("client_id"),
        body.get("client_secret"),
        body.get("scope"),
        authorization);
  }

  private Map<String, Object> token(
      String grantType, String clientId, String secret, String scope, String authorization) {
    log.info("POST /api/integration/oauth/token tenantId=null clientId={}", clientId);
    if (authorization != null && authorization.startsWith("Basic ")) {
      try {
        String decoded =
            new String(
                Base64.getDecoder().decode(authorization.substring(6).trim()),
                StandardCharsets.UTF_8);
        int idx = decoded.indexOf(':');
        if (idx > 0) {
          clientId = decoded.substring(0, idx);
          secret = decoded.substring(idx + 1);
        }
      } catch (IllegalArgumentException e) {
        throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "INVALID_CLIENT");
      }
    }
    try {
      IssuedToken token = tokenService.issue(grantType, clientId, secret, scope);
      Map<String, Object> response = new LinkedHashMap<>();
      response.put("access_token", token.accessToken());
      response.put("token_type", "Bearer");
      response.put("expires_in", token.expiresInSeconds());
      response.put("scope", token.scope());
      log.info("POST /api/integration/oauth/token tenantId=null status=200 clientId={}", clientId);
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "POST /api/integration/oauth/token tenantId=null status={} error={}",
          ex.getStatusCode().value(),
          ex.getReason());
      throw ex;
    }
  }

  /** {@code { "17": { "version": 42, "flags": { "STOCK_MODULE": true, … } } }}. */
  @GetMapping("/feature-flags/resolved")
  public Map<String, Object> resolvedFlags(
      @AuthenticationPrincipal IntegrationPrincipal principal,
      @RequestParam(name = "prefix", defaultValue = StockFeatureFlagPublisher.PREFIX) String prefix,
      @RequestParam(name = "tenantIds") String tenantIds) {
    if (principal == null || !principal.hasScope(IntegrationTokenService.SCOPE_FLAGS_READ)) {
      log.error("GET /api/integration/feature-flags/resolved tenantId=null status=403");
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "INVALID_SCOPE");
    }
    if (!StockFeatureFlagPublisher.PREFIX.equals(prefix)) {
      // Only STOCK_* flags are ever exposed to Stock.
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_PREFIX");
    }
    Set<Long> ids = new LinkedHashSet<>();
    for (String raw : Arrays.stream(tenantIds.split(",")).map(String::trim).toList()) {
      if (raw.isEmpty()) {
        continue;
      }
      try {
        ids.add(Long.parseLong(raw));
      } catch (NumberFormatException e) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_TENANT_IDS");
      }
    }
    if (ids.size() > MAX_TENANTS) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_TENANT_IDS");
    }
    log.info(
        "GET /api/integration/feature-flags/resolved tenantId=null clientId={} tenants={}",
        principal.clientId(),
        ids.size());
    Map<String, Object> out = new LinkedHashMap<>();
    for (Long id : ids) {
      if (!flagPublisher.tenantExists(id)) {
        continue;
      }
      Map<String, Object> entry = new LinkedHashMap<>();
      entry.put("version", flagPublisher.currentVersion(id));
      entry.put("flags", flagPublisher.resolvedStockFlags(id));
      out.put(String.valueOf(id), entry);
    }
    log.info("GET /api/integration/feature-flags/resolved tenantId=null status=200");
    return out;
  }
}
