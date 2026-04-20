package com.cursorpoc.backend.web;

import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.AuthService;
import com.cursorpoc.backend.web.dto.ActivateProfessionalRequest;
import com.cursorpoc.backend.web.dto.ActivationTokenInfoResponse;
import com.cursorpoc.backend.web.dto.ForgotPasswordRequest;
import com.cursorpoc.backend.web.dto.LoginRequest;
import com.cursorpoc.backend.web.dto.ResetPasswordRequest;
import com.cursorpoc.backend.web.dto.TokenResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

  private final AuthService authService;

  public AuthController(AuthService authService) {
    this.authService = authService;
  }

  @PostMapping("/login")
  public TokenResponse login(
      @Valid @RequestBody LoginRequest request,
      @org.springframework.web.bind.annotation.RequestHeader(value = "Origin", required = false)
          String origin) {
    return authService.login(request, origin);
  }

  @PostMapping("/refresh")
  public TokenResponse refresh(@AuthenticationPrincipal FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    return authService.refresh(principal);
  }

  @PostMapping("/forgot-password")
  public ResponseEntity<Void> forgotPassword(
      @Valid @RequestBody ForgotPasswordRequest request,
      @org.springframework.web.bind.annotation.RequestHeader(value = "Origin", required = false)
          String origin) {
    authService.forgotPassword(request, origin);
    return ResponseEntity.noContent().build();
  }

  @PostMapping("/reset-password")
  public ResponseEntity<Void> resetPassword(@Valid @RequestBody ResetPasswordRequest request) {
    authService.resetPassword(request);
    return ResponseEntity.noContent().build();
  }

  @GetMapping("/validate-activation-token")
  public ActivationTokenInfoResponse validateActivationToken(@RequestParam String token) {
    return authService.validateActivationToken(token);
  }

  @PostMapping("/activate")
  public ResponseEntity<Void> activate(@Valid @RequestBody ActivateProfessionalRequest request) {
    authService.activateProfessionalAccount(request);
    return ResponseEntity.noContent().build();
  }
}
