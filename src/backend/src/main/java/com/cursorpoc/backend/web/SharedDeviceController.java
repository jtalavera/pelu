package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.SharedDeviceService;
import com.cursorpoc.backend.service.SharedDeviceService.ActivatedDevice;
import com.cursorpoc.backend.service.SharedDeviceService.DeviceResponse;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** HU-66: shared devices administration (Configuración del negocio) — tenant ADMIN only. */
@RestController
@RequestMapping("/api/shared-devices")
public class SharedDeviceController {

  private static final Logger log = LoggerFactory.getLogger(SharedDeviceController.class);

  public record ActivateRequest(String name, String password) {}

  private final SharedDeviceService service;

  public SharedDeviceController(SharedDeviceService service) {
    this.service = service;
  }

  @GetMapping
  public List<DeviceResponse> list(@AuthenticationPrincipal FemmeUserPrincipal principal) {
    requireAdmin(principal);
    log.info("GET /api/shared-devices tenantId={}", principal.getTenantId());
    List<DeviceResponse> devices = service.list(principal.getTenantId());
    log.info("GET /api/shared-devices tenantId={} status=200", principal.getTenantId());
    return devices;
  }

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  public ActivatedDevice activate(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @RequestBody ActivateRequest request) {
    requireAdmin(principal);
    log.info("POST /api/shared-devices tenantId={}", principal.getTenantId());
    try {
      ActivatedDevice device =
          service.activate(
              principal,
              request == null ? null : request.name(),
              request == null ? null : request.password());
      log.info("POST /api/shared-devices tenantId={} status=201", principal.getTenantId());
      return device;
    } catch (ResponseStatusException ex) {
      log.error(
          "POST /api/shared-devices tenantId={} status={}",
          principal.getTenantId(),
          ex.getStatusCode().value());
      throw ex;
    }
  }

  @PostMapping("/{id}/revoke")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void revoke(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable("id") long id) {
    requireAdmin(principal);
    log.info("POST /api/shared-devices/{}/revoke tenantId={}", id, principal.getTenantId());
    service.revoke(principal.getTenantId(), id);
    log.info(
        "POST /api/shared-devices/{}/revoke tenantId={} status=204", id, principal.getTenantId());
  }

  @PostMapping("/{id}/unlock")
  public DeviceResponse unlock(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable("id") long id) {
    requireAdmin(principal);
    log.info("POST /api/shared-devices/{}/unlock tenantId={}", id, principal.getTenantId());
    DeviceResponse device = service.unlockDevice(principal.getTenantId(), id);
    log.info(
        "POST /api/shared-devices/{}/unlock tenantId={} status=200", id, principal.getTenantId());
    return device;
  }

  private static void requireAdmin(FemmeUserPrincipal principal) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    if (principal.getRole() != UserRole.ADMIN) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
  }
}
