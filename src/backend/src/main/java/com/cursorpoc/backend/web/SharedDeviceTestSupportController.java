package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.ProfessionalPinLock;
import com.cursorpoc.backend.domain.SharedDevice;
import com.cursorpoc.backend.repository.ProfessionalPinLockRepository;
import com.cursorpoc.backend.repository.SharedDeviceRepository;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Test-only support endpoint, gated behind {@code femme.data-init.enabled} like {@link
 * AppointmentTestSupportController} (true only for the {@code e2e} profile). Never reachable in
 * production.
 *
 * <p>HU-66: PIN locks last 15 minutes. This makes every lock of a shared device (and the device's
 * own lock) already expired, so Playwright can check that a lock lifts by itself without waiting.
 * Tenant-scoped through the authenticated principal.
 */
@RestController
@RequestMapping("/api/admin/shared-device-test-support")
@ConditionalOnProperty(name = "femme.data-init.enabled", havingValue = "true")
public class SharedDeviceTestSupportController {

  private static final Logger log =
      LoggerFactory.getLogger(SharedDeviceTestSupportController.class);

  private final SharedDeviceRepository deviceRepository;
  private final ProfessionalPinLockRepository lockRepository;

  public SharedDeviceTestSupportController(
      SharedDeviceRepository deviceRepository, ProfessionalPinLockRepository lockRepository) {
    this.deviceRepository = deviceRepository;
    this.lockRepository = lockRepository;
  }

  @PostMapping("/{deviceId}/expire-locks")
  @Transactional
  public void expireLocks(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable long deviceId) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    log.info(
        "POST /api/admin/shared-device-test-support/{}/expire-locks tenantId={}",
        deviceId,
        principal.getTenantId());
    SharedDevice device =
        deviceRepository
            .findByIdAndTenant_Id(deviceId, principal.getTenantId())
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "SHARED_DEVICE_NOT_FOUND"));
    Instant past = Instant.now().minusSeconds(1);
    if (device.getLockedUntil() != null) {
      device.setLockedUntil(past);
      deviceRepository.save(device);
    }
    for (ProfessionalPinLock lock : lockRepository.findByDevice_Id(deviceId)) {
      if (lock.getLockedUntil() != null) {
        lock.setLockedUntil(past);
        lockRepository.save(lock);
      }
    }
    log.info(
        "POST /api/admin/shared-device-test-support/{}/expire-locks tenantId={} status=200",
        deviceId,
        principal.getTenantId());
  }
}
