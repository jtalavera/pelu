package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.AuditLog;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.Tier;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.AuditLogRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.repository.TierRepository;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.security.JwtService;
import com.cursorpoc.backend.service.SharedDeviceService.ActivatedDevice;
import com.cursorpoc.backend.service.SharedDeviceService.PinLoginFailure;
import com.cursorpoc.backend.service.SharedDeviceService.PinLoginResult;
import com.cursorpoc.backend.service.SharedDeviceService.PinLoginSuccess;
import com.cursorpoc.backend.web.dto.ProfessionalUpsertRequest;
import java.util.List;
import java.util.Locale;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** HU-66: shared devices and PIN login, through the real services and H2 schema. */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class SharedDeviceIntegrationTest {

  private static final String ADMIN_PASSWORD = "Admin123!";

  @Autowired private TierRepository tierRepository;
  @Autowired private TenantRepository tenantRepository;
  @Autowired private AppUserRepository appUserRepository;
  @Autowired private ProfessionalRepository professionalRepository;
  @Autowired private AuditLogRepository auditLogRepository;
  @Autowired private PasswordEncoder passwordEncoder;
  @Autowired private JwtService jwtService;
  @Autowired private SharedDeviceService service;
  @Autowired private ProfessionalDirectoryService directory;

  private long tenantId;
  private FemmeUserPrincipal admin;

  @BeforeEach
  void setUp() {
    Tier tier = new Tier();
    tier.setName("Tier " + System.nanoTime());
    tier = tierRepository.save(tier);
    Tenant tenant = new Tenant();
    tenant.setName("Salon " + System.nanoTime());
    tenant.setTier(tier);
    tenant = tenantRepository.save(tenant);
    tenantId = tenant.getId();
    AppUser user = new AppUser();
    user.setTenant(tenant);
    user.setEmail("admin" + System.nanoTime() + "@test.com");
    user.setPasswordHash(passwordEncoder.encode(ADMIN_PASSWORD));
    user.setRole(UserRole.ADMIN);
    user.setEnabled(true);
    user = appUserRepository.save(user);
    admin = new FemmeUserPrincipal(user.getId(), tenantId, user.getEmail(), UserRole.ADMIN, null);
  }

  private long professional(String name, String pin, boolean active) {
    var created =
        directory.create(
            tenantId,
            new ProfessionalUpsertRequest(name, null, null, null, pin, false),
            Locale.ENGLISH);
    if (!active) {
      directory.deactivate(tenantId, created.id());
    }
    return created.id();
  }

  private String device() {
    return service.activate(admin, "Tablet recepción", ADMIN_PASSWORD).deviceToken();
  }

  private static PinLoginFailure failure(PinLoginResult r) {
    assertThat(r).isInstanceOf(PinLoginFailure.class);
    return (PinLoginFailure) r;
  }

  private static void assertCode(Runnable call, String code) {
    assertThatThrownBy(call::run)
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining(code);
  }

  // ── Activation / revocation ─────────────────────────────────────────────────────────────────

  @Test
  void activate_requiresTheAdminPasswordAndAName() {
    assertCode(() -> service.activate(admin, "Tablet", "wrong"), "SHARED_DEVICE_PASSWORD_INVALID");
    assertCode(() -> service.activate(admin, "  ", ADMIN_PASSWORD), "SHARED_DEVICE_NAME_REQUIRED");
    ActivatedDevice ok = service.activate(admin, "Tablet", ADMIN_PASSWORD);
    assertThat(ok.deviceToken()).isNotBlank();
    assertThat(service.list(tenantId)).extracting(d -> d.name()).containsExactly("Tablet");
  }

  @Test
  void revokedDevice_isRejected() {
    ActivatedDevice d = service.activate(admin, "Tablet", ADMIN_PASSWORD);
    service.revoke(tenantId, d.device().id());
    assertCode(() -> service.picker(d.deviceToken()), "SHARED_DEVICE_INVALID");
    assertThat(service.list(tenantId)).isEmpty();
    assertCode(() -> service.picker("not-a-device"), "SHARED_DEVICE_INVALID");
  }

  // ── Picker ──────────────────────────────────────────────────────────────────────────────────

  @Test
  void picker_listsOnlyActiveProfessionalsWithAPin() {
    professional("Ana", "1234", true);
    professional("Bea", null, true);
    professional("Carla", "5678", false);
    var picker = service.picker(device());
    assertThat(picker.professionals()).extracting(p -> p.fullName()).containsExactly("ANA");
  }

  // ── PIN login ───────────────────────────────────────────────────────────────────────────────

  @Test
  void correctPin_opensACalendarOnlyPinSessionBoundToTheDevice() {
    long ana = professional("Ana", "1234", true);
    String token = device();
    PinLoginResult r = service.pinLogin(token, ana, "1234");
    assertThat(r).isInstanceOf(PinLoginSuccess.class);
    FemmeUserPrincipal session =
        jwtService.parseAndValidate(((PinLoginSuccess) r).accessToken()).orElseThrow();
    assertThat(session.isPinSession()).isTrue();
    assertThat(session.getRole()).isEqualTo(UserRole.PROFESSIONAL);
    assertThat(session.getProfessionalId()).isEqualTo(ana);
    assertThat(session.getTenantId()).isEqualTo(tenantId);
    assertThat(((PinLoginSuccess) r).expiresInSeconds()).isEqualTo(15 * 60);
  }

  @Test
  void wrongPin_isGeneric_countsDown_andLocksAfterFive_untilTheAdminUnlocks() {
    long ana = professional("Ana", "1234", true);
    String token = device();
    for (int remaining = 4; remaining >= 1; remaining--) {
      PinLoginFailure f = failure(service.pinLogin(token, ana, "0000"));
      assertThat(f.status()).isEqualTo(HttpStatus.UNAUTHORIZED);
      assertThat(f.error()).isEqualTo("PIN_INVALID");
      assertThat(f.remainingAttempts()).isEqualTo(remaining);
    }
    PinLoginFailure locked = failure(service.pinLogin(token, ana, "0000"));
    assertThat(locked.status()).isEqualTo(HttpStatus.LOCKED);
    assertThat(locked.error()).isEqualTo("PIN_LOCKED");
    assertThat(locked.lockedUntil()).isNotNull();
    // Even the right PIN is refused while locked; the picker and the admin see the lock.
    assertThat(failure(service.pinLogin(token, ana, "1234")).error()).isEqualTo("PIN_LOCKED");
    assertThat(service.picker(token).professionals().get(0).lockedUntil()).isNotNull();
    assertThat(service.activeLocks(ana)).hasSize(1);

    directory.unlockPin(tenantId, ana);
    assertThat(service.activeLocks(ana)).isEmpty();
    assertThat(service.pinLogin(token, ana, "1234")).isInstanceOf(PinLoginSuccess.class);
  }

  @Test
  void unknownOrInactiveProfessional_getsTheSameAnswerAsAWrongPin() {
    long carla = professional("Carla", "5678", false);
    String token = device();
    PinLoginFailure f = failure(service.pinLogin(token, carla, "5678"));
    assertThat(f.error()).isEqualTo("PIN_INVALID");
    assertThat(failure(service.pinLogin(token, 999_999L, "1234")).error()).isEqualTo("PIN_INVALID");
  }

  @Test
  void twentyFailuresOnADevice_lockTheWholeDevice_untilTheAdminUnlocksIt() {
    List<Long> pros =
        List.of(
            professional("A", "1111", true),
            professional("B", "2222", true),
            professional("C", "3333", true),
            professional("D", "4444", true),
            professional("E", "5555", true));
    ActivatedDevice d = service.activate(admin, "Tablet", ADMIN_PASSWORD);
    PinLoginFailure last = null;
    for (int i = 0; i < 20; i++) {
      last = failure(service.pinLogin(d.deviceToken(), pros.get(i % 5), "9999"));
    }
    assertThat(last.error()).isEqualTo("SHARED_DEVICE_PIN_LOCKED");
    assertThat(service.picker(d.deviceToken()).deviceLockedUntil()).isNotNull();
    assertThat(failure(service.pinLogin(d.deviceToken(), pros.get(0), "1111")).error())
        .isEqualTo("SHARED_DEVICE_PIN_LOCKED");

    service.unlockDevice(tenantId, d.device().id());
    directory.unlockPin(tenantId, pros.get(0));
    assertThat(service.pinLogin(d.deviceToken(), pros.get(0), "1111"))
        .isInstanceOf(PinLoginSuccess.class);
  }

  @Test
  void pinSetBeforeHu66_worksOnceAgainstTheFingerprint_andGetsItsHash() {
    long ana = professional("Ana", "1234", true);
    Professional p = professionalRepository.findById(ana).orElseThrow();
    p.setPinHash(null); // as if the PIN had been set before HU-66
    professionalRepository.save(p);
    assertThat(service.pinLogin(device(), ana, "1234")).isInstanceOf(PinLoginSuccess.class);
    assertThat(professionalRepository.findById(ana).orElseThrow().getPinHash()).isNotNull();
  }

  @Test
  void changingOrClearingThePin_bumpsItsVersion() {
    long ana = professional("Ana", "1234", true);
    int v0 = professionalRepository.findById(ana).orElseThrow().getPinVersion();
    directory.update(
        tenantId,
        ana,
        new ProfessionalUpsertRequest("Ana", null, null, null, "4321", false),
        Locale.ENGLISH);
    int v1 = professionalRepository.findById(ana).orElseThrow().getPinVersion();
    directory.update(
        tenantId,
        ana,
        new ProfessionalUpsertRequest("Ana", null, null, null, null, false),
        Locale.ENGLISH);
    int v2 = professionalRepository.findById(ana).orElseThrow().getPinVersion();
    directory.update(
        tenantId,
        ana,
        new ProfessionalUpsertRequest("Ana", null, null, null, "", false),
        Locale.ENGLISH);
    int v3 = professionalRepository.findById(ana).orElseThrow().getPinVersion();
    assertThat(v1).isEqualTo(v0 + 1);
    assertThat(v2).isEqualTo(v1); // null = PIN untouched
    assertThat(v3).isEqualTo(v2 + 1);
  }

  @Test
  void pinLoginsAndLocks_areAudited() {
    long ana = professional("Ana", "1234", true);
    String token = device();
    service.pinLogin(token, ana, "1234");
    for (int i = 0; i < 5; i++) {
      service.pinLogin(token, ana, "0000");
    }
    List<AuditLog> rows =
        auditLogRepository.findAll().stream()
            .filter(a -> a.getTenantId() != null && a.getTenantId() == tenantId)
            .filter(a -> "shared-device".equals(a.getResource()))
            .toList();
    assertThat(rows)
        .anyMatch(a -> "pin-login".equals(a.getOperation()) && a.getStatusCode() == 200);
    assertThat(rows)
        .anyMatch(a -> "pin-login".equals(a.getOperation()) && a.getStatusCode() == 401);
    assertThat(rows).anyMatch(a -> "pin-lock".equals(a.getOperation()) && a.getStatusCode() == 423);
    assertThat(rows).allMatch(a -> a.getUserEmail().contains("professional-" + ana));
  }
}
