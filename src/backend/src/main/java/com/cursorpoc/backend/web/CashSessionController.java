package com.cursorpoc.backend.web;

import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.CashSessionService;
import com.cursorpoc.backend.web.dto.CashSessionOpenRequest;
import com.cursorpoc.backend.web.dto.CashSessionResponse;
import jakarta.validation.Valid;
import java.util.Optional;
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

  private final CashSessionService cashSessionService;

  public CashSessionController(CashSessionService cashSessionService) {
    this.cashSessionService = cashSessionService;
  }

  @GetMapping("/current")
  public ResponseEntity<CashSessionResponse> getCurrent(
      @AuthenticationPrincipal FemmeUserPrincipal principal) {
    requirePrincipal(principal);
    Optional<CashSessionResponse> current =
        cashSessionService.getCurrentSession(principal.getTenantId());
    return current.map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.noContent().build());
  }

  @PostMapping("/open")
  public ResponseEntity<CashSessionResponse> open(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @Valid @RequestBody CashSessionOpenRequest request) {
    requirePrincipal(principal);
    CashSessionResponse response =
        cashSessionService.openSession(principal.getTenantId(), principal.getUserId(), request);
    return ResponseEntity.status(HttpStatus.CREATED).body(response);
  }

  private static void requirePrincipal(FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
  }
}
