package com.cursorpoc.backend.web;

import com.cursorpoc.backend.security.DeviceTokens;
import com.cursorpoc.backend.service.SharedDeviceService;
import com.cursorpoc.backend.service.SharedDeviceService.PickerResponse;
import com.cursorpoc.backend.service.SharedDeviceService.PinLoginFailure;
import com.cursorpoc.backend.service.SharedDeviceService.PinLoginResult;
import com.cursorpoc.backend.service.SharedDeviceService.PinLoginSuccess;
import com.cursorpoc.backend.web.dto.TokenResponse;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-66: what a shared device calls before anyone is logged in — authenticated by the device
 * credential header ({@link DeviceTokens#HEADER}), never by a JWT. Permitted in SecurityConfig.
 */
@RestController
@RequestMapping("/api/shared-device")
public class SharedDeviceSessionController {

  private static final Logger log = LoggerFactory.getLogger(SharedDeviceSessionController.class);

  public record PinLoginRequest(Long professionalId, String pin) {}

  private final SharedDeviceService service;

  public SharedDeviceSessionController(SharedDeviceService service) {
    this.service = service;
  }

  /** Criterion 4: the professional picker (and lock states) for this device. */
  @GetMapping("/session")
  public PickerResponse session(
      @RequestHeader(name = DeviceTokens.HEADER, required = false) String deviceToken) {
    log.info("GET /api/shared-device/session");
    try {
      PickerResponse picker = service.picker(deviceToken);
      log.info("GET /api/shared-device/session deviceId={} status=200", picker.deviceId());
      return picker;
    } catch (ResponseStatusException ex) {
      log.error("GET /api/shared-device/session status={}", ex.getStatusCode().value());
      throw ex;
    }
  }

  /** Criteria 6–8, 10, 11: exchanges a PIN for a calendar-only professional session. */
  @PostMapping("/pin-login")
  public ResponseEntity<?> pinLogin(
      @RequestHeader(name = DeviceTokens.HEADER, required = false) String deviceToken,
      @RequestBody PinLoginRequest request) {
    log.info("POST /api/shared-device/pin-login");
    long professionalId =
        request == null || request.professionalId() == null ? -1L : request.professionalId();
    PinLoginResult result =
        service.pinLogin(deviceToken, professionalId, request == null ? null : request.pin());
    if (result instanceof PinLoginSuccess ok) {
      log.info("POST /api/shared-device/pin-login professionalId={} status=200", professionalId);
      return ResponseEntity.ok(
          new TokenResponse(ok.accessToken(), ok.expiresInSeconds(), "Bearer"));
    }
    PinLoginFailure failure = (PinLoginFailure) result;
    log.error(
        "POST /api/shared-device/pin-login professionalId={} status={} error={}",
        professionalId,
        failure.status().value(),
        failure.error());
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("error", failure.error());
    if (failure.remainingAttempts() != null) {
      body.put("remainingAttempts", failure.remainingAttempts());
    }
    if (failure.lockedUntil() != null) {
      body.put("lockedUntil", failure.lockedUntil().toString());
    }
    return ResponseEntity.status(failure.status()).body(body);
  }
}
