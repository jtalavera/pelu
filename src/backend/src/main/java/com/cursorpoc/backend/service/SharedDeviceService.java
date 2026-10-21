package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.ProfessionalPinLock;
import com.cursorpoc.backend.domain.SharedDevice;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.ProfessionalPinLockRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.SharedDeviceRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.security.DeviceTokens;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.security.JwtService;
import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-66: shared salon devices and PIN login.
 *
 * <ul>
 *   <li>An administrator enables the current device (confirming her password), lists, revokes and
 *       unlocks devices from Configuración del negocio.
 *   <li>The device shows the active professionals with a PIN and exchanges a PIN for a short,
 *       calendar-only professional session bound to that device.
 *   <li>5 wrong PINs in a row lock one professional on one device for 15 minutes; 20 wrong PINs in
 *       15 minutes lock the whole device for 15 minutes. Administrators can lift either lock.
 * </ul>
 */
@Service
public class SharedDeviceService {

  private static final Logger log = LoggerFactory.getLogger(SharedDeviceService.class);

  public static final int MAX_FAILED_PER_PROFESSIONAL = 5;
  public static final int MAX_FAILED_PER_DEVICE = 20;
  public static final Duration LOCK_DURATION = Duration.ofMinutes(15);
  public static final Duration DEVICE_WINDOW = Duration.ofMinutes(15);

  static final String AUDIT_PIN_LOGIN = "/api/shared-device/pin-login";
  static final String AUDIT_PIN_LOCK = "/api/shared-device/pin-lock";
  static final String AUDIT_DEVICE_LOCK = "/api/shared-device/device-lock";

  public record DeviceResponse(
      long id, String name, Instant createdAt, Instant lastUsedAt, Instant lockedUntil) {}

  public record ActivatedDevice(DeviceResponse device, String deviceToken, String tenantName) {}

  public record PickerProfessional(
      long id, String fullName, String photoDataUrl, Instant lockedUntil) {}

  public record PickerResponse(
      long deviceId,
      String deviceName,
      String tenantName,
      Instant deviceLockedUntil,
      List<PickerProfessional> professionals) {}

  public record PinLockResponse(long deviceId, String deviceName, Instant lockedUntil) {}

  /** Outcome of a PIN attempt; failures carry what the keypad shows. */
  public sealed interface PinLoginResult permits PinLoginSuccess, PinLoginFailure {}

  public record PinLoginSuccess(String accessToken, long expiresInSeconds)
      implements PinLoginResult {}

  public record PinLoginFailure(
      HttpStatus status, String error, Integer remainingAttempts, Instant lockedUntil)
      implements PinLoginResult {}

  private final SharedDeviceRepository deviceRepository;
  private final ProfessionalPinLockRepository lockRepository;
  private final ProfessionalRepository professionalRepository;
  private final AppUserRepository appUserRepository;
  private final TenantRepository tenantRepository;
  private final PasswordEncoder passwordEncoder;
  private final JwtService jwtService;
  private final AuditLogService auditLogService;

  public SharedDeviceService(
      SharedDeviceRepository deviceRepository,
      ProfessionalPinLockRepository lockRepository,
      ProfessionalRepository professionalRepository,
      AppUserRepository appUserRepository,
      TenantRepository tenantRepository,
      PasswordEncoder passwordEncoder,
      JwtService jwtService,
      AuditLogService auditLogService) {
    this.deviceRepository = deviceRepository;
    this.lockRepository = lockRepository;
    this.professionalRepository = professionalRepository;
    this.appUserRepository = appUserRepository;
    this.tenantRepository = tenantRepository;
    this.passwordEncoder = passwordEncoder;
    this.jwtService = jwtService;
    this.auditLogService = auditLogService;
  }

  // ── Administration (Configuración del negocio) ──────────────────────────────────────────────

  /** Criteria 1–2: enables the caller's device; the raw credential is returned only here. */
  @Transactional
  public ActivatedDevice activate(FemmeUserPrincipal admin, String name, String password) {
    String trimmedName = name == null ? "" : name.trim();
    if (trimmedName.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SHARED_DEVICE_NAME_REQUIRED");
    }
    if (trimmedName.length() > 100) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SHARED_DEVICE_NAME_TOO_LONG");
    }
    if (admin.isImpersonation()) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "IMPERSONATION_ACTION_NOT_ALLOWED");
    }
    AppUser user =
        appUserRepository
            .findById(admin.getUserId())
            .filter(u -> u.getRole() == UserRole.ADMIN)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN"));
    if (password == null || !passwordEncoder.matches(password, user.getPasswordHash())) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SHARED_DEVICE_PASSWORD_INVALID");
    }
    Tenant tenant =
        tenantRepository
            .findById(admin.getTenantId())
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND"));
    String raw = DeviceTokens.newRawToken();
    SharedDevice device = new SharedDevice();
    device.setTenant(tenant);
    device.setName(trimmedName);
    device.setTokenHash(DeviceTokens.hash(raw));
    device.setCreatedAt(Instant.now());
    device.setCreatedByUserId(user.getId());
    deviceRepository.save(device);
    log.info("shared device enabled tenantId={} deviceId={}", tenant.getId(), device.getId());
    return new ActivatedDevice(toResponse(device), raw, tenant.getName());
  }

  /** Criterion 3: the tenant's enabled devices. */
  @Transactional(readOnly = true)
  public List<DeviceResponse> list(long tenantId) {
    return deviceRepository.findByTenant_IdAndRevokedAtIsNullOrderByCreatedAtDesc(tenantId).stream()
        .map(SharedDeviceService::toResponse)
        .toList();
  }

  /** Criterion 3: a revoked device goes back to the normal login on its next request. */
  @Transactional
  public void revoke(long tenantId, long deviceId) {
    SharedDevice device = loadDevice(tenantId, deviceId);
    if (!device.isRevoked()) {
      device.setRevokedAt(Instant.now());
      deviceRepository.save(device);
    }
  }

  /** Criterion 14: lifts a device lock and resets its failed-attempt window. */
  @Transactional
  public DeviceResponse unlockDevice(long tenantId, long deviceId) {
    SharedDevice device = loadDevice(tenantId, deviceId);
    device.setLockedUntil(null);
    device.setFailedCount(0);
    device.setFailedWindowStartedAt(null);
    deviceRepository.save(device);
    return toResponse(device);
  }

  /** Criterion 13: lifts a professional's PIN lock on every device and resets her counters. */
  @Transactional
  public void unlockProfessional(long tenantId, long professionalId) {
    professionalRepository
        .findByIdAndTenant_Id(professionalId, tenantId)
        .orElseThrow(
            () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "PROFESSIONAL_NOT_FOUND"));
    for (ProfessionalPinLock lock : lockRepository.findByProfessional_Id(professionalId)) {
      lock.setFailedCount(0);
      lock.setLockedUntil(null);
      lockRepository.save(lock);
    }
  }

  /** Criterion 12: where (and until when) a professional's PIN login is locked right now. */
  @Transactional(readOnly = true)
  public List<PinLockResponse> activeLocks(long professionalId) {
    Instant now = Instant.now();
    return lockRepository.findByProfessional_Id(professionalId).stream()
        .filter(l -> l.isLockedAt(now) && !l.getDevice().isRevoked())
        .map(
            l ->
                new PinLockResponse(
                    l.getDevice().getId(), l.getDevice().getName(), l.getLockedUntil()))
        .toList();
  }

  // ── The shared device itself ────────────────────────────────────────────────────────────────

  /** Criterion 4 (+9, 11): who can log in here, and who/what is locked. */
  @Transactional
  public PickerResponse picker(String rawDeviceToken) {
    SharedDevice device = resolve(rawDeviceToken);
    Instant now = Instant.now();
    long tenantId = device.getTenant().getId();
    Map<Long, ProfessionalPinLock> locks =
        lockRepository.findByDevice_Id(device.getId()).stream()
            .collect(Collectors.toMap(l -> l.getProfessional().getId(), Function.identity()));
    List<PickerProfessional> professionals =
        professionalRepository.findByTenant_IdOrderByFullNameAsc(tenantId).stream()
            .filter(p -> p.isActive() && p.hasPin())
            .sorted(Comparator.comparing(Professional::getFullName))
            .map(
                p -> {
                  ProfessionalPinLock lock = locks.get(p.getId());
                  Instant lockedUntil =
                      lock != null && lock.isLockedAt(now) ? lock.getLockedUntil() : null;
                  return new PickerProfessional(
                      p.getId(), p.getFullName(), p.getPhotoDataUrl(), lockedUntil);
                })
            .toList();
    return new PickerResponse(
        device.getId(),
        device.getName(),
        device.getTenant().getName(),
        device.isLockedAt(now) ? device.getLockedUntil() : null,
        professionals);
  }

  /** Criteria 6, 8, 10, 11, 16, 18: one PIN attempt. Failures are committed, not rolled back. */
  @Transactional
  public PinLoginResult pinLogin(String rawDeviceToken, long professionalId, String pin) {
    SharedDevice device = resolve(rawDeviceToken);
    long tenantId = device.getTenant().getId();
    Instant now = Instant.now();
    if (device.isLockedAt(now)) {
      return new PinLoginFailure(
          HttpStatus.LOCKED, "SHARED_DEVICE_PIN_LOCKED", null, device.getLockedUntil());
    }

    Optional<Professional> candidate =
        professionalRepository
            .findByIdAndTenant_Id(professionalId, tenantId)
            .filter(p -> p.isActive() && p.hasPin());
    if (candidate.isEmpty()) {
      // Never reveal whether the professional exists / has a PIN: same answer as a wrong PIN.
      return registerDeviceFailure(device, now, null, MAX_FAILED_PER_PROFESSIONAL);
    }
    Professional professional = candidate.get();
    ProfessionalPinLock lock =
        lockRepository
            .findByDevice_IdAndProfessional_Id(device.getId(), professional.getId())
            .orElseGet(
                () -> {
                  ProfessionalPinLock created = new ProfessionalPinLock();
                  created.setDevice(device);
                  created.setProfessional(professional);
                  return created;
                });
    if (lock.isLockedAt(now)) {
      return new PinLoginFailure(HttpStatus.LOCKED, "PIN_LOCKED", 0, lock.getLockedUntil());
    }

    if (pinMatches(professional, tenantId, pin)) {
      lock.setFailedCount(0);
      lock.setLockedUntil(null);
      lockRepository.save(lock);
      device.setLastUsedAt(now);
      deviceRepository.save(device);
      FemmeUserPrincipal session =
          FemmeUserPrincipal.pinSession(
              tenantId, professional.getId(), device.getId(), professional.getPinVersion());
      audit(session, AUDIT_PIN_LOGIN, professional.getId(), 200);
      return new PinLoginSuccess(
          jwtService.createPinSessionToken(session, now), JwtService.PIN_SESSION_TTL_SECONDS);
    }

    lock.setFailedCount(lock.getFailedCount() + 1);
    FemmeUserPrincipal who =
        FemmeUserPrincipal.pinSession(
            tenantId, professional.getId(), device.getId(), professional.getPinVersion());
    audit(who, AUDIT_PIN_LOGIN, professional.getId(), 401);
    if (lock.getFailedCount() >= MAX_FAILED_PER_PROFESSIONAL) {
      lock.setFailedCount(0);
      lock.setLockedUntil(now.plus(LOCK_DURATION));
      lockRepository.save(lock);
      audit(who, AUDIT_PIN_LOCK, professional.getId(), 423);
      registerDeviceFailure(device, now, who, 0);
      return new PinLoginFailure(HttpStatus.LOCKED, "PIN_LOCKED", 0, lock.getLockedUntil());
    }
    lockRepository.save(lock);
    PinLoginFailure deviceOutcome = registerDeviceFailure(device, now, who, 0);
    if (deviceOutcome.status() == HttpStatus.LOCKED) {
      return deviceOutcome;
    }
    return new PinLoginFailure(
        HttpStatus.UNAUTHORIZED,
        "PIN_INVALID",
        MAX_FAILED_PER_PROFESSIONAL - lock.getFailedCount(),
        null);
  }

  /** Counts a failed attempt against the whole device (criterion 11). */
  private PinLoginFailure registerDeviceFailure(
      SharedDevice device, Instant now, FemmeUserPrincipal who, int remainingIfOpen) {
    Instant windowStart = device.getFailedWindowStartedAt();
    if (windowStart == null || !now.isBefore(windowStart.plus(DEVICE_WINDOW))) {
      device.setFailedWindowStartedAt(now);
      device.setFailedCount(1);
    } else {
      device.setFailedCount(device.getFailedCount() + 1);
    }
    if (device.getFailedCount() >= MAX_FAILED_PER_DEVICE) {
      device.setLockedUntil(now.plus(LOCK_DURATION));
      device.setFailedCount(0);
      device.setFailedWindowStartedAt(null);
      deviceRepository.save(device);
      audit(
          who != null ? who : deviceActor(device),
          AUDIT_DEVICE_LOCK,
          device.getId(),
          HttpStatus.LOCKED.value());
      return new PinLoginFailure(
          HttpStatus.LOCKED, "SHARED_DEVICE_PIN_LOCKED", null, device.getLockedUntil());
    }
    deviceRepository.save(device);
    return new PinLoginFailure(HttpStatus.UNAUTHORIZED, "PIN_INVALID", remainingIfOpen, null);
  }

  /**
   * Criterion 16: BCrypt check against {@code pin_hash}; PINs set before HU-66 only have HU-22's
   * fingerprint — they are checked against it once and get their hash on that first success.
   */
  private boolean pinMatches(Professional professional, long tenantId, String pin) {
    if (pin == null || !pin.trim().matches("\\d{4,7}")) {
      return false;
    }
    String trimmed = pin.trim();
    if (professional.getPinHash() != null) {
      return passwordEncoder.matches(trimmed, professional.getPinHash());
    }
    boolean legacy =
        AuthService.sha256Hex(tenantId + ":" + trimmed).equals(professional.getPinFingerprint());
    if (legacy) {
      professional.setPinHash(passwordEncoder.encode(trimmed));
      professionalRepository.save(professional);
    }
    return legacy;
  }

  /** The credential a device sends; unknown or revoked → 401 so it falls back to the login. */
  private SharedDevice resolve(String rawDeviceToken) {
    if (rawDeviceToken == null || rawDeviceToken.isBlank()) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "SHARED_DEVICE_INVALID");
    }
    return deviceRepository
        .findByTokenHash(DeviceTokens.hash(rawDeviceToken.trim()))
        .filter(d -> !d.isRevoked())
        .orElseThrow(
            () -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "SHARED_DEVICE_INVALID"));
  }

  private SharedDevice loadDevice(long tenantId, long deviceId) {
    return deviceRepository
        .findByIdAndTenant_Id(deviceId, tenantId)
        .orElseThrow(
            () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "SHARED_DEVICE_NOT_FOUND"));
  }

  /** Criterion 18: PIN logins and locks are not regular API calls, so they are recorded here. */
  private void audit(FemmeUserPrincipal who, String pattern, long entityId, int status) {
    auditLogService.record(who, "POST", pattern, String.valueOf(entityId), status);
  }

  private static FemmeUserPrincipal deviceActor(SharedDevice device) {
    return new FemmeUserPrincipal(
        0L, device.getTenant().getId(), "device-" + device.getId(), UserRole.PROFESSIONAL, null);
  }

  private static DeviceResponse toResponse(SharedDevice d) {
    Instant now = Instant.now();
    return new DeviceResponse(
        d.getId(),
        d.getName(),
        d.getCreatedAt(),
        d.getLastUsedAt(),
        d.isLockedAt(now) ? d.getLockedUntil() : null);
  }
}
