package com.cursorpoc.backend.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.enums.UserRole;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

/**
 * HU-34 AC-2: a {@code PLATFORM_ADMIN} {@link AppUser} can be created and persisted with no tenant
 * at all — the system does not require one for this role. Runs against the real JPA mapping + H2
 * schema (MSSQL compat mode, {@code create-drop}), not a mock, so it also proves the entity's
 * relaxed {@code @JoinColumn(nullable = true)} (see {@code AppUser.tenant}) actually takes effect
 * at the persistence layer, not just in Java.
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class AppUserRepositoryPlatformAdminTest {

  @Autowired private AppUserRepository appUserRepository;

  @Test
  void platformAdmin_canBePersistedWithNoTenant() {
    AppUser platformAdmin = new AppUser();
    platformAdmin.setTenant(null);
    platformAdmin.setEmail("hu34-platform-admin@e2e.test");
    platformAdmin.setPasswordHash("irrelevant-hash-value");
    platformAdmin.setRole(UserRole.PLATFORM_ADMIN);
    platformAdmin.setEnabled(true);

    AppUser saved = appUserRepository.save(platformAdmin);
    appUserRepository.flush();

    AppUser reloaded = appUserRepository.findById(saved.getId()).orElseThrow();
    assertThat(reloaded.getTenant()).isNull();
    assertThat(reloaded.getTenantId()).isNull();
    assertThat(reloaded.getRole()).isEqualTo(UserRole.PLATFORM_ADMIN);

    AppUser byEmail = appUserRepository.findByEmail("hu34-platform-admin@e2e.test").orElseThrow();
    assertThat(byEmail.getTenant()).isNull();
  }
}
