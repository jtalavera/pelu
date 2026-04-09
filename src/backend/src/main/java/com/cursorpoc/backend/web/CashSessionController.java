package com.cursorpoc.backend.web;

import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.CashSessionService;
import com.cursorpoc.backend.web.dto.CashSessionCloseRequest;
import com.cursorpoc.backend.web.dto.CashSessionCloseResponse;
import com.cursorpoc.backend.web.dto.CashSessionOpenRequest;
import com.cursorpoc.backend.web.dto.CashSessionResponse;
import jakarta.validation.Valid;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/cash-sessions")
public class CashSessionController {

  private static final Logger log = LoggerFactory.getLogger(CashSessionController.class);

  private final CashSessionService cashSessionService;

  public CashSessionController(CashSessionService cashSessionService) {
    this.cashSessionService = cashSessionService;
  }

  @GetMapping("/current")
  public ResponseEntity<CashSessionResponse> getCurrent(
      @AuthenticationPrincipal FemmeUserPrincipal principal) {
    requirePrincipal(principal);
    log.info("GET /api/cash-sessions/current tenantId={}", principal.getTenantId());
    Optional<CashSessionResponse> current =
        cashSessionService.getCurrentSession(principal.getTenantId());
    int statusCode = current.isPresent() ? 200 : 204;
    log.info(
        "GET /api/cash-sessions/current tenantId={} status={}",
        principal.getTenantId(),
        statusCode);
    return current.map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.noContent().build());
  }

  @PostMapping("/open")
  public ResponseEntity<CashSessionResponse> open(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @Valid @RequestBody CashSessionOpenRequest request) {
    requirePrincipal(principal);
    log.info("POST /api/cash-sessions/open tenantId={}", principal.getTenantId());
    CashSessionResponse response =
        cashSessionService.openSession(principal.getTenantId(), principal.getUserId(), request);
    log.info("POST /api/cash-sessions/open tenantId={} status=201", principal.getTenantId());
    return ResponseEntity.status(HttpStatus.CREATED).body(response);
  }

  @PostMapping("/close")
  public ResponseEntity<CashSessionCloseResponse> close(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @Valid @RequestBody CashSessionCloseRequest request) {
    requirePrincipal(principal);
    log.info("POST /api/cash-sessions/close tenantId={}", principal.getTenantId());
    CashSessionCloseResponse response =
        cashSessionService.closeSession(principal.getTenantId(), principal.getUserId(), request);
    log.info("POST /api/cash-sessions/close tenantId={} status=200", principal.getTenantId());
    return ResponseEntity.ok(response);
  }

  private static void requirePrincipal(FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
  }
}
