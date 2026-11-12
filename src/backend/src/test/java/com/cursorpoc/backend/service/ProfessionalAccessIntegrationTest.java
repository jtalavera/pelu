package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.ProfessionalActivationToken;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.Tier;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.ProfessionalActivationTokenRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.repository.TierRepository;
import com.cursorpoc.backend.web.dto.ActivateProfessionalRequest;
import com.cursorpoc.backend.web.dto.ProfessionalResponse;
import com.cursorpoc.backend.web.dto.ProfessionalUpsertRequest;
import jakarta.persistence.EntityManager;
import java.time.Duration;
import java.util.Locale;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Issue #38 "Acceso al sistema para profesionales", end to end through the real services and H2
 * schema: (1) access needs a valid email on every path, (2) email changes move the access to the
 * new email, (3) one email ↔ one user ↔ one professional, (4) status line, (5) resend + cooldown.
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class ProfessionalAccessIntegrationTest {

  private static final String PASSWORD = "ValidPass1!";

  @Autowired private TierRepository tierRepository;
  @Autowired private TenantRepository tenantRepository;
  @Autowired private AppUserRepository appUserRepository;
  @Autowired private ProfessionalRepository professionalRepository;
  @Autowired private ProfessionalActivationTokenRepository tokenRepository;
  @Autowired private ProfessionalDirectoryService directory;
  @Autowired private AuthService authService;
  @Autowired private EntityManager em;

  private Tenant tenant;
  private long tenantId;

  @BeforeEach
  void setUp() {
    Tier tier = new Tier();
    tier.setName("Tier " + System.nanoTime());
    tier = tierRepository.save(tier);
    tenant = new Tenant();
    tenant.setName("Salon " + System.nanoTime());
    tenant.setTier(tier);
    tenant = tenantRepository.save(tenant);
    tenantId = tenant.getId();
  }

  private static ProfessionalUpsertRequest req(String name, String email, Boolean access) {
    return new ProfessionalUpsertRequest(name, null, email, null, null, access);
  }

  private static String uniqueEmail(String prefix) {
    return prefix + System.nanoTime() + "@test.com";
  }

  private ProfessionalResponse createWithAccess(String email) {
    return directory.create(tenantId, req("Ana", email, true), Locale.ENGLISH);
  }

  /** Activates the latest invitation of the professional, like the /activate page does. */
  private void activate(long professionalId) {
    String raw = directory.grantAccess(tenantId, professionalId, Locale.ENGLISH).rawToken();
    authService.activateAccount(new ActivateProfessionalRequest(raw, PASSWORD, PASSWORD, null));
  }

  private ProfessionalResponse reload(long id) {
    return directory.list(tenantId).stream().filter(p -> p.id() == id).findFirst().orElseThrow();
  }

  /** Bulk "invalidate all links" updates bypass the persistence context — re-read from the DB. */
  private void fresh() {
    em.flush();
    em.clear();
  }

  private static void assertCode(Runnable call, String code) {
    assertThatThrownBy(call::run)
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining(code);
  }

  // ── (1) email required on every path ────────────────────────────────────────────────────────

  @Test
  void create_withAccessAndNoEmail_isRejectedAndNothingIsSaved() {
    long before = professionalRepository.countByTenant_Id(tenantId);
    assertCode(
        () -> directory.create(tenantId, req("Ana", null, true), Locale.ENGLISH),
        "PROFESSIONAL_EMAIL_REQUIRED_FOR_ACCESS");
    assertThat(professionalRepository.countByTenant_Id(tenantId)).isEqualTo(before);
  }

  @Test
  void update_clearingTheEmailWhileAccessIsOn_isRejected() {
    ProfessionalResponse p = createWithAccess(uniqueEmail("clear"));
    assertCode(
        () -> directory.update(tenantId, p.id(), req("Ana", "  ", true), Locale.ENGLISH),
        "PROFESSIONAL_EMAIL_REQUIRED_FOR_ACCESS");
  }

  @Test
  void update_turningAccessOnWithoutEmail_isRejected() {
    ProfessionalResponse p = directory.create(tenantId, req("Ana", null, false), Locale.ENGLISH);
    assertCode(
        () -> directory.update(tenantId, p.id(), req("Ana", null, true), Locale.ENGLISH),
        "PROFESSIONAL_EMAIL_REQUIRED_FOR_ACCESS");
    assertThat(reload(p.id()).systemAccessAllowed()).isFalse();
  }

  @Test
  void grantEndpoint_withoutEmail_isRejected() {
    ProfessionalResponse p = directory.create(tenantId, req("Ana", null, false), Locale.ENGLISH);
    assertCode(
        () -> directory.grantAccess(tenantId, p.id(), Locale.ENGLISH),
        "PROFESSIONAL_EMAIL_REQUIRED_FOR_ACCESS");
  }

  @Test
  void access_withMalformedEmail_isRejected() {
    assertCode(
        () -> directory.create(tenantId, req("Ana", "not-an-email", true), Locale.ENGLISH),
        "PROFESSIONAL_EMAIL_INVALID_FOR_ACCESS");
  }

  // ── (4) status line ─────────────────────────────────────────────────────────────────────────

  @Test
  void status_goesFromNoAccess_toInvitationSent_toActive() {
    ProfessionalResponse p = directory.create(tenantId, req("Ana", null, false), Locale.ENGLISH);
    assertThat(p.accessStatus()).isEqualTo("NO_ACCESS");

    String email = uniqueEmail("status");
    ProfessionalResponse invited =
        directory.update(tenantId, p.id(), req("Ana", email, true), Locale.ENGLISH);
    assertThat(invited.accessStatus()).isEqualTo("INVITATION_SENT");
    assertThat(invited.invitationSentAt()).isNotNull();
    assertThat(invited.invitationExpiresAt())
        .isEqualTo(invited.invitationSentAt().plus(Duration.ofHours(48)));

    activate(p.id());
    ProfessionalResponse active = reload(p.id());
    assertThat(active.accessStatus()).isEqualTo("ACTIVE");
    assertThat(active.accessLoginEmail()).isEqualTo(email);
  }

  @Test
  void status_isExpired_whenTheLinkWasNotUsedIn48Hours() {
    ProfessionalResponse p = createWithAccess(uniqueEmail("expired"));
    ProfessionalActivationToken token =
        tokenRepository.findFirstByProfessional_IdOrderByIdDesc(p.id()).orElseThrow();
    token.setCreatedAt(token.getCreatedAt().minus(Duration.ofHours(49)));
    token.setExpiresAt(token.getExpiresAt().minus(Duration.ofHours(49)));
    tokenRepository.save(token);
    assertThat(reload(p.id()).accessStatus()).isEqualTo("INVITATION_EXPIRED");
  }

  // ── (5) resend ──────────────────────────────────────────────────────────────────────────────

  @Test
  void resend_isBlockedForTwoMinutes_thenIssuesANewLinkAndInvalidatesTheOldOne() {
    ProfessionalResponse p = createWithAccess(uniqueEmail("resend"));
    assertThat(p.resendAvailableAt()).isEqualTo(p.invitationSentAt().plus(Duration.ofMinutes(2)));
    assertCode(
        () -> directory.resendAccess(tenantId, p.id(), Locale.ENGLISH),
        "ACTIVATION_RESEND_TOO_SOON");

    ProfessionalActivationToken first =
        tokenRepository.findFirstByProfessional_IdOrderByIdDesc(p.id()).orElseThrow();
    first.setCreatedAt(first.getCreatedAt().minus(Duration.ofMinutes(3)));
    tokenRepository.save(first);

    ProfessionalResponse resent = directory.resendAccess(tenantId, p.id(), Locale.ENGLISH);
    assertThat(resent.accessStatus()).isEqualTo("INVITATION_SENT");
    ProfessionalActivationToken second =
        tokenRepository.findFirstByProfessional_IdOrderByIdDesc(p.id()).orElseThrow();
    assertThat(second.getId()).isNotEqualTo(first.getId());
    fresh();
    assertThat(tokenRepository.findById(first.getId()).orElseThrow().isUsed()).isTrue();
    assertThat(Duration.between(second.getCreatedAt(), second.getExpiresAt()))
        .isEqualTo(Duration.ofHours(48));
  }

  @Test
  void resend_isRejected_withoutAccessOrOnceThePasswordExists() {
    ProfessionalResponse none = directory.create(tenantId, req("Ana", null, false), Locale.ENGLISH);
    assertCode(
        () -> directory.resendAccess(tenantId, none.id(), Locale.ENGLISH),
        "PROFESSIONAL_ACCESS_NOT_ENABLED");

    ProfessionalResponse p = createWithAccess(uniqueEmail("active"));
    activate(p.id());
    assertCode(
        () -> directory.resendAccess(tenantId, p.id(), Locale.ENGLISH),
        "PROFESSIONAL_ACCESS_ALREADY_ACTIVE");
  }

  // ── (2) email change ────────────────────────────────────────────────────────────────────────

  @Test
  void emailChange_withAccessOn_disablesTheOldUser_andInvitesTheNewEmail() {
    String oldEmail = uniqueEmail("old");
    ProfessionalResponse p = createWithAccess(oldEmail);
    activate(p.id());
    AppUser oldUser = appUserRepository.findByEmailAndTenant_Id(oldEmail, tenantId).orElseThrow();

    String newEmail = uniqueEmail("new");
    ProfessionalResponse updated =
        directory.update(tenantId, p.id(), req("Ana", newEmail, true), Locale.ENGLISH);

    assertThat(updated.accessStatus()).isEqualTo("INVITATION_SENT");
    assertThat(updated.hasUserAccount()).isFalse();
    assertThat(appUserRepository.findById(oldUser.getId()).orElseThrow().isEnabled()).isFalse();

    // The new invitation creates a fresh user for the new email; the old one stays disabled.
    activate(p.id());
    AppUser newUser = appUserRepository.findByEmailAndTenant_Id(newEmail, tenantId).orElseThrow();
    assertThat(newUser.isEnabled()).isTrue();
    assertThat(professionalRepository.findById(p.id()).orElseThrow().getUser().getId())
        .isEqualTo(newUser.getId());
    assertThat(appUserRepository.findById(oldUser.getId()).orElseThrow().isEnabled()).isFalse();
  }

  @Test
  void emailChange_withAccessOff_isAllowed_andTheOldUserStaysDisabledAndUnlinked() {
    String oldEmail = uniqueEmail("old");
    ProfessionalResponse p = createWithAccess(oldEmail);
    activate(p.id());
    directory.update(tenantId, p.id(), req("Ana", oldEmail, false), Locale.ENGLISH);

    ProfessionalResponse updated =
        directory.update(tenantId, p.id(), req("Ana", uniqueEmail("new"), false), Locale.ENGLISH);

    assertThat(updated.accessStatus()).isEqualTo("NO_ACCESS");
    assertThat(updated.hasUserAccount()).isFalse();
    assertThat(
            appUserRepository.findByEmailAndTenant_Id(oldEmail, tenantId).orElseThrow().isEnabled())
        .isFalse();
  }

  @Test
  void emailChange_ofAPendingInvitation_invalidatesTheOldLink() {
    ProfessionalResponse p = createWithAccess(uniqueEmail("pending"));
    ProfessionalActivationToken oldLink =
        tokenRepository.findFirstByProfessional_IdOrderByIdDesc(p.id()).orElseThrow();
    directory.update(tenantId, p.id(), req("Ana", uniqueEmail("other"), true), Locale.ENGLISH);
    fresh();
    assertThat(tokenRepository.findById(oldLink.getId()).orElseThrow().isUsed()).isTrue();
  }

  // ── (3) uniqueness ──────────────────────────────────────────────────────────────────────────

  @Test
  void access_withTheEmailOfAnAdminUser_isRejected() {
    AppUser admin = new AppUser();
    admin.setTenant(tenant);
    admin.setEmail(uniqueEmail("admin"));
    admin.setPasswordHash("irrelevant-hash-value");
    admin.setRole(UserRole.ADMIN);
    admin.setEnabled(true);
    appUserRepository.save(admin);

    assertCode(() -> createWithAccess(admin.getEmail()), "PROFESSIONAL_EMAIL_USED_BY_ANOTHER_USER");
  }

  @Test
  void access_withTheEmailOfAnotherProfessionalsUser_isRejected() {
    String email = uniqueEmail("shared");
    ProfessionalResponse first = createWithAccess(email);
    activate(first.id());
    // The first professional moves away from the email but her (disabled) user keeps it...
    directory.update(tenantId, first.id(), req("Ana", uniqueEmail("moved"), false), Locale.ENGLISH);
    // ...an orphan PROFESSIONAL user can be reused by whoever now owns that email.
    ProfessionalResponse second =
        directory.create(tenantId, req("Bea", email, true), Locale.ENGLISH);
    activate(second.id());
    Professional linked = professionalRepository.findById(second.id()).orElseThrow();
    assertThat(linked.getUser().getEmail()).isEqualTo(email);
    assertThat(linked.getUser().isEnabled()).isTrue();

    // But a user linked to another professional can never be shared.
    Professional third = new Professional();
    third.setTenant(tenant);
    third.setFullName("CARLA");
    third.setActive(true);
    third.setEmail(email.toUpperCase(Locale.ROOT));
    professionalRepository.save(third);
    assertCode(
        () -> directory.grantAccess(tenantId, third.getId(), Locale.ENGLISH),
        "PROFESSIONAL_EMAIL_USED_BY_ANOTHER_USER");
  }

  @Test
  void revoke_neverDisablesAnAdminLinkedToTheProfessional() {
    AppUser admin = new AppUser();
    admin.setTenant(tenant);
    admin.setEmail(uniqueEmail("owner"));
    admin.setPasswordHash("irrelevant-hash-value");
    admin.setRole(UserRole.ADMIN);
    admin.setEnabled(true);
    appUserRepository.save(admin);
    Professional legacy = new Professional();
    legacy.setTenant(tenant);
    legacy.setFullName("OWNER");
    legacy.setActive(true);
    legacy.setEmail(admin.getEmail());
    legacy.setSystemAccessAllowed(true);
    legacy.setUser(admin);
    professionalRepository.save(legacy);

    directory.revokeAccess(tenantId, legacy.getId());

    assertThat(appUserRepository.findById(admin.getId()).orElseThrow().isEnabled()).isTrue();
  }

  @Test
  void savingALegacyProfessionalLinkedToAnAdmin_withoutChangingAccessOrEmail_stillWorks() {
    AppUser admin = new AppUser();
    admin.setTenant(tenant);
    admin.setEmail(uniqueEmail("owner"));
    admin.setPasswordHash("irrelevant-hash-value");
    admin.setRole(UserRole.ADMIN);
    admin.setEnabled(true);
    appUserRepository.save(admin);
    Professional legacy = new Professional();
    legacy.setTenant(tenant);
    legacy.setFullName("OWNER");
    legacy.setActive(true);
    legacy.setEmail(admin.getEmail());
    legacy.setSystemAccessAllowed(true);
    legacy.setUser(admin);
    professionalRepository.save(legacy);

    ProfessionalResponse saved =
        directory.update(
            tenantId, legacy.getId(), req("Owner Renamed", admin.getEmail(), true), Locale.ENGLISH);

    assertThat(saved.fullName()).isEqualTo("OWNER RENAMED");
    assertThat(saved.accessStatus()).isEqualTo("ACTIVE");
  }
}
