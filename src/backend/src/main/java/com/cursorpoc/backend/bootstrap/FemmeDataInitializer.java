package com.cursorpoc.backend.bootstrap;

import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.BusinessProfile;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.security.crypto.password.PasswordEncoder;

@Configuration
public class FemmeDataInitializer {

  private static final Logger log = LoggerFactory.getLogger(FemmeDataInitializer.class);

  @Bean
  @Profile("!test")
  CommandLineRunner femmeSeed(
      TenantRepository tenantRepository,
      AppUserRepository appUserRepository,
      BusinessProfileRepository businessProfileRepository,
      PasswordEncoder passwordEncoder) {
    return args -> {
      if (appUserRepository.count() > 0) {
        return;
      }
      Tenant tenant = new Tenant();
      tenant.setName("Demo salon");
      tenantRepository.save(tenant);

      AppUser user = new AppUser();
      user.setTenant(tenant);
      user.setEmail("admin@demo.com");
      user.setPasswordHash(passwordEncoder.encode("Demo123!"));
      user.setRole(UserRole.ADMIN);
      appUserRepository.save(user);

      BusinessProfile profile = new BusinessProfile();
      profile.setTenant(tenant);
      profile.setBusinessName("Demo salon");
      businessProfileRepository.save(profile);

      log.info(
          "Seeded demo tenant id={} and admin user admin@demo.com (password Demo123!)",
          tenant.getId());
    };
  }
}
