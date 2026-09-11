package com.cursorpoc.backend.bootstrap;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.config.FemmePlatformAdminProperties;
import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.annotation.Transactional;

/**
 * HU-57 · Bootstrap inicial: crear únicamente el primer Platform Admin
 * requirements/multi-tenant/HU-57-bootstrap-inicial-de-platform-admin.md
 *
 * <p>{@code PlatformAdminBootstrap} is deliberately NOT wired behind the {@code femmeSeed}/{@code
 * femme.data-init.enabled} conditional bean (that would defeat AC-1's "must work in production,
 * which never sets that flag"), so it can't be exercised end-to-end by booting the whole app under
 * the {@code test} profile the way other seed logic is (its {@code CommandLineRunner} registration
 * is {@code @Profile("!test")}, same as every other boot seed, to keep other @SpringBootTest
 * suites' user counts predictable). Instead these tests autowire the plain {@code @Component}
 * directly and call {@link PlatformAdminBootstrap#bootstrapIfNeeded()} themselves against the real
 * H2 schema — equivalent coverage without needing a real process boot per test case. Playwright
 * can't add anything beyond this: HU-57 has no UI of its own, and e2e's single shared backend
 * process only demonstrates "boots once, works" (see hu-34-rol-platform-admin.spec.ts's
 * platform-admin login), not the empty-DB-vs-already-seeded branch behavior these tests isolate.
 */
@SpringBootTest
@ActiveProfiles("test")
@TestPropertySource(
    properties = {
      "app.femme.platform-admin.email=hu57-bootstrap-admin@pelu.test",
      "app.femme.platform-admin.password=Hu57.Bootstrap.Password123!"
    })
@Transactional
class PlatformAdminBootstrapTest {

  @Autowired private PlatformAdminBootstrap platformAdminBootstrap;
  @Autowired private AppUserRepository appUserRepository;
  @Autowired private TenantRepository tenantRepository;
  @Autowired private PasswordEncoder passwordEncoder;

  // AC-1: fresh/empty database -> creates exactly one PLATFORM_ADMIN from configuration.
  @Test
  void freshDatabase_createsExactlyOnePlatformAdmin() {
    assertThat(appUserRepository.count()).isZero();

    platformAdminBootstrap.bootstrapIfNeeded();

    assertThat(appUserRepository.count()).isEqualTo(1);
    AppUser created = appUserRepository.findByEmail("hu57-bootstrap-admin@pelu.test").orElseThrow();
    assertThat(created.getRole()).isEqualTo(UserRole.PLATFORM_ADMIN);
    assertThat(created.getTenant()).isNull();
    assertThat(passwordEncoder.matches("Hu57.Bootstrap.Password123!", created.getPasswordHash()))
        .isTrue();
  }

  // AC-2: the bootstrap never creates a tenant or any ADMIN/PROFESSIONAL user alongside the
  // platform admin — no demo tenant, no business data.
  @Test
  void freshDatabase_createsNoTenantAndNoOtherRoles() {
    platformAdminBootstrap.bootstrapIfNeeded();

    assertThat(tenantRepository.count()).isZero();
    assertThat(appUserRepository.findAll())
        .extracting(AppUser::getRole)
        .containsOnly(UserRole.PLATFORM_ADMIN);
  }

  // AC-3 (idempotence, same config): calling the bootstrap again after one already exists must
  // not create or modify a second one.
  @Test
  void secondCall_doesNotDuplicate() {
    platformAdminBootstrap.bootstrapIfNeeded();
    AppUser firstRun =
        appUserRepository.findByEmail("hu57-bootstrap-admin@pelu.test").orElseThrow();

    platformAdminBootstrap.bootstrapIfNeeded();

    assertThat(appUserRepository.count()).isEqualTo(1);
    AppUser afterSecondRun =
        appUserRepository.findByEmail("hu57-bootstrap-admin@pelu.test").orElseThrow();
    assertThat(afterSecondRun.getId()).isEqualTo(firstRun.getId());
    assertThat(afterSecondRun.getPasswordHash()).isEqualTo(firstRun.getPasswordHash());
  }

  // AC-3 (idempotence, pre-existing admin from elsewhere): if a PLATFORM_ADMIN already exists —
  // regardless of how it got there, e.g. one created by another Platform Admin via the platform
  // UI/API — the bootstrap must leave it completely untouched and never create a second one,
  // even though its configured email differs from the pre-existing admin's.
  @Test
  void existingPlatformAdminFromElsewhere_isNeverModifiedOrDuplicated() {
    AppUser preExisting = new AppUser();
    preExisting.setTenant(null);
    preExisting.setEmail("already-here@pelu.test");
    preExisting.setPasswordHash(passwordEncoder.encode("Whatever.Existing.Password1"));
    preExisting.setRole(UserRole.PLATFORM_ADMIN);
    appUserRepository.save(preExisting);

    platformAdminBootstrap.bootstrapIfNeeded();

    assertThat(appUserRepository.count()).isEqualTo(1);
    AppUser reloaded = appUserRepository.findByEmail("already-here@pelu.test").orElseThrow();
    assertThat(reloaded.getPasswordHash()).isEqualTo(preExisting.getPasswordHash());
    assertThat(appUserRepository.findByEmail("hu57-bootstrap-admin@pelu.test")).isEmpty();
  }

  // Security-sensitive edge case: no hardcoded fallback credential exists anywhere in code (see
  // FemmePlatformAdminProperties), so an unconfigured email/password must skip cleanly rather
  // than ever falling back to an insecure literal or crashing the whole boot.
  @Test
  void missingConfiguration_skipsWithoutCreatingOrThrowing() {
    PlatformAdminBootstrap unconfigured =
        new PlatformAdminBootstrap(
            appUserRepository, new FemmePlatformAdminProperties(), passwordEncoder);

    unconfigured.bootstrapIfNeeded();

    assertThat(appUserRepository.count()).isZero();
  }
}
