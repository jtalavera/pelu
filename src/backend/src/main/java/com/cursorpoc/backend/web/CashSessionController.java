package com.cursorpoc.backend.web;

import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.CashSessionService;
import com.cursorpoc.backend.web.dto.CashMovementCreateRequest;
import com.cursorpoc.backend.web.dto.CashMovementResponse;
import com.cursorpoc.backend.web.dto.CashSessionCloseRequest;
import com.cursorpoc.backend.web.dto.CashSessionDetailResponse;
import com.cursorpoc.backend.web.dto.CashSessionOpenRequest;
import com.cursorpoc.backend.web.dto.CashSessionResponse;
import com.cursorpoc.backend.web.dto.PagedCashSessionsResponse;
import jakarta.validation.Valid;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
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
    try {
      Optional<CashSessionResponse> current =
          cashSessionService.getCurrentSession(principal.getTenantId());
      int statusCode = current.isPresent() ? 200 : 204;
      log.info(
          "GET /api/cash-sessions/current tenantId={} status={}",
          principal.getTenantId(),
          statusCode);
      return current.map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.noContent().build());
    } catch (ResponseStatusException ex) {
      log.error(
          "GET /api/cash-sessions/current tenantId={} status={}",
          principal.getTenantId(),
          ex.getStatusCode().value());
      throw ex;
    }
  }

  @PostMapping("/open")
  public ResponseEntity<CashSessionResponse> open(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @Valid @RequestBody CashSessionOpenRequest request) {
    requirePrincipal(principal);
    log.info("POST /api/cash-sessions/open tenantId={}", principal.getTenantId());
    try {
      CashSessionResponse response =
          cashSessionService.openSession(principal.getTenantId(), principal.getUserId(), request);
      log.info("POST /api/cash-sessions/open tenantId={} status=201", principal.getTenantId());
      return ResponseEntity.status(HttpStatus.CREATED).body(response);
    } catch (ResponseStatusException ex) {
      log.error(
          "POST /api/cash-sessions/open tenantId={} status={}",
          principal.getTenantId(),
          ex.getStatusCode().value());
      throw ex;
    }
  }

  @PostMapping("/close")
  public ResponseEntity<CashSessionDetailResponse> close(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @Valid @RequestBody CashSessionCloseRequest request) {
    requirePrincipal(principal);
    log.info("POST /api/cash-sessions/close tenantId={}", principal.getTenantId());
    try {
      CashSessionDetailResponse response =
          cashSessionService.closeSession(principal.getTenantId(), principal.getUserId(), request);
      log.info("POST /api/cash-sessions/close tenantId={} status=200", principal.getTenantId());
      return ResponseEntity.ok(response);
    } catch (ResponseStatusException ex) {
      log.error(
          "POST /api/cash-sessions/close tenantId={} status={}",
          principal.getTenantId(),
          ex.getStatusCode().value());
      throw ex;
    }
  }

  @PostMapping("/current/movements")
  public ResponseEntity<CashMovementResponse> createMovement(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @Valid @RequestBody CashMovementCreateRequest request) {
    requirePrincipal(principal);
    log.info(
        "POST /api/cash-sessions/current/movements tenantId={} type={}",
        principal.getTenantId(),
        request.type());
    try {
      CashMovementResponse response =
          cashSessionService.createMovement(
              principal.getTenantId(), principal.getUserId(), request);
      log.info(
          "POST /api/cash-sessions/current/movements tenantId={} type={} status=201",
          principal.getTenantId(),
          request.type());
      return ResponseEntity.status(HttpStatus.CREATED).body(response);
    } catch (ResponseStatusException ex) {
      log.error(
          "POST /api/cash-sessions/current/movements tenantId={} type={} status={}",
          principal.getTenantId(),
          request.type(),
          ex.getStatusCode().value());
      throw ex;
    }
  }

  @GetMapping("/{id}/movements")
  public List<CashMovementResponse> listMovements(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable Long id) {
    requirePrincipal(principal);
    log.info("GET /api/cash-sessions/{}/movements tenantId={}", id, principal.getTenantId());
    try {
      List<CashMovementResponse> response =
          cashSessionService.listMovements(principal.getTenantId(), id);
      log.info(
          "GET /api/cash-sessions/{}/movements tenantId={} status=200",
          id,
          principal.getTenantId());
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "GET /api/cash-sessions/{}/movements tenantId={} status={}",
          id,
          principal.getTenantId(),
          ex.getStatusCode().value());
      throw ex;
    }
  }

  @GetMapping
  public PagedCashSessionsResponse list(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @RequestParam(required = false) String from,
      @RequestParam(required = false) String to,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) String q,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "10") int size) {
    requirePrincipal(principal);
    log.info(
        "GET /api/cash-sessions tenantId={} page={} size={}", principal.getTenantId(), page, size);
    Instant fromInstant = from != null ? Instant.parse(from) : null;
    Instant toInstant = to != null ? Instant.parse(to) : null;
    try {
      PagedCashSessionsResponse response =
          cashSessionService.listSessions(
              principal.getTenantId(), fromInstant, toInstant, status, q, page, size);
      log.info("GET /api/cash-sessions tenantId={} status=200", principal.getTenantId());
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "GET /api/cash-sessions tenantId={} status={}",
          principal.getTenantId(),
          ex.getStatusCode().value());
      throw ex;
    }
  }

  @GetMapping("/{id}")
  public CashSessionDetailResponse getDetail(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable Long id) {
    requirePrincipal(principal);
    log.info("GET /api/cash-sessions/{} tenantId={}", id, principal.getTenantId());
    try {
      CashSessionDetailResponse response =
          cashSessionService.getSessionDetail(principal.getTenantId(), id);
      log.info("GET /api/cash-sessions/{} tenantId={} status=200", id, principal.getTenantId());
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "GET /api/cash-sessions/{} tenantId={} status={}",
          id,
          principal.getTenantId(),
          ex.getStatusCode().value());
      throw ex;
    }
  }

  private static void requirePrincipal(FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
  }
}
