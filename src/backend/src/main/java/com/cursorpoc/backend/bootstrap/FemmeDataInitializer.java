package com.cursorpoc.backend.bootstrap;

import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.BusinessProfile;
import com.cursorpoc.backend.domain.FeatureFlag;
import com.cursorpoc.backend.domain.FiscalStamp;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.Tier;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import com.cursorpoc.backend.repository.FeatureFlagRepository;
import com.cursorpoc.backend.repository.FiscalStampRepository;
import com.cursorpoc.backend.repository.TierRepository;
import java.time.LocalDate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.security.crypto.password.PasswordEncoder;

@Configuration
public class FemmeDataInitializer {

  private static final Logger log = LoggerFactory.getLogger(FemmeDataInitializer.class);

  private final AppUserRepository appUserRepository;
  private final BusinessProfileRepository businessProfileRepository;
  private final FiscalStampRepository fiscalStampRepository;
  private final FeatureFlagRepository featureFlagRepository;
  private final TierRepository tierRepository;
  private final PasswordEncoder passwordEncoder;

  public FemmeDataInitializer(
      AppUserRepository appUserRepository,
      BusinessProfileRepository businessProfileRepository,
      FiscalStampRepository fiscalStampRepository,
      FeatureFlagRepository featureFlagRepository,
      TierRepository tierRepository,
      PasswordEncoder passwordEncoder) {
    this.appUserRepository = appUserRepository;
    this.businessProfileRepository = businessProfileRepository;
    this.fiscalStampRepository = fiscalStampRepository;
    this.featureFlagRepository = featureFlagRepository;
    this.tierRepository = tierRepository;
    this.passwordEncoder = passwordEncoder;
  }

  // HU-56: this runner used to also reconcile the salon catalog (categories/services) and client
  // list against static seed CSVs for the first tenant on every boot — that logic hard-deleted
  // clients that had gained real invoices/appointments since the CSV was last updated, tripping
  // fk_inv_client / fk_appt_client and crash-looping the container in prod (2026-07-14). HU-56
  // removed that reconciliation from system boot entirely. HU-58 went further and removed this
  // runner's own creation of a demo tenant + admin user too — per the PRD's "Sin seed hardcodeado"
  // (no tenant/user/service/client/professional is created automatically at boot, only the first
  // Platform Admin — see PlatformAdminBootstrap below). The Playwright e2e suite now provisions its
  // own tenant + tenant admin dynamically via the real Platform Admin API (see
  // e2e/global-setup.ts), the same way a real onboarding would, instead of relying on a
  // backend-seeded tenant id=1. What remains below (feature flags, tiers) is genuinely
  // tenant-independent platform configuration, not a specific tenant's business data — Flyway's
  // equivalent inserts (V28, V41, V43) don't reach the `e2e` profile (Flyway disabled there, JPA
  // create-drop only builds the schema), so this runner is what makes them exist for Playwright.
  // Re-enable this runner by setting femme.data-init.enabled=true (dev opt-in / e2e).
  @Bean
  @Profile("!test")
  @ConditionalOnProperty(name = "femme.data-init.enabled", havingValue = "true")
  CommandLineRunner femmeSeed() {
    return args -> {
      if (featureFlagRepository.findByFlagKey("GUIDED_TOUR").isEmpty()) {
        FeatureFlag guidedTour = new FeatureFlag();
        guidedTour.setFlagKey("GUIDED_TOUR");
        guidedTour.setEnabled(true);
        guidedTour.setDescription("Show guided tour tooltips on every screen");
        featureFlagRepository.save(guidedTour);
        log.info("Seeded feature flag GUIDED_TOUR (enabled=true)");
      }

      if (featureFlagRepository.findByFlagKey("ALLOW_DUPLICATE_CLIENT_EMAIL").isEmpty()) {
        FeatureFlag allowDuplicateClientEmail = new FeatureFlag();
        allowDuplicateClientEmail.setFlagKey("ALLOW_DUPLICATE_CLIENT_EMAIL");
        allowDuplicateClientEmail.setEnabled(false);
        allowDuplicateClientEmail.setDescription(
            "Test environment only: skip the per-tenant client-email uniqueness check so SIFEN"
                + " electronic-invoicing testing can reuse the same recipient email. Ignored unless"
                + " the SIFEN environment is TEST.");
        featureFlagRepository.save(allowDuplicateClientEmail);
        log.info("Seeded feature flag ALLOW_DUPLICATE_CLIENT_EMAIL (enabled=false)");
      }


      // SIFEN HU-22 (Fase 5): same idempotent seed as GUIDED_TOUR above. V28's Flyway INSERT only
      // reaches dev/prod (Flyway is disabled for the `e2e` profile, JPA create-drop only builds the
      // schema, not row data), so this runner is what actually makes the flag exist for Playwright.
      if (featureFlagRepository.findByFlagKey("SIFEN_ELECTRONIC_INVOICING").isEmpty()) {
        FeatureFlag sifenElectronicInvoicing = new FeatureFlag();
        sifenElectronicInvoicing.setFlagKey("SIFEN_ELECTRONIC_INVOICING");
        sifenElectronicInvoicing.setEnabled(false);
        sifenElectronicInvoicing.setDescription(
            "Route new invoices through the SIFEN electronic-invoicing pipeline instead of the"
                + " traditional generator");
        featureFlagRepository.save(sifenElectronicInvoicing);
        log.info("Seeded feature flag SIFEN_ELECTRONIC_INVOICING (enabled=false)");
      }

      // HU-37: the "create tenant" form needs at least one existing Tier to select from (HU-45's
      // full tier CRUD hasn't landed yet). V41's Flyway INSERT only reaches dev/prod the same way
      // V28's flag INSERT does above — Flyway is disabled for the `e2e` profile — so this runner
      // seeds the same default tier there too. HU-38 (editar tenant) needs a *second* tier to
      // exercise an actual tier change (V43's Flyway INSERT, mirrored here for the same reason).
      if (tierRepository.count() == 0) {
        Tier defaultTier = new Tier();
        defaultTier.setName("Estándar");
        defaultTier.setDescription("Tier por defecto.");
        tierRepository.save(defaultTier);
        log.info("Seeded default tier 'Estándar'");
      // SIFEN testing: same idempotent seed as SIFEN_ELECTRONIC_INVOICING above — V51's Flyway
      // INSERT only reaches dev/prod (Flyway is disabled for the `e2e` profile), so this runner is
      // what makes the flag exist for Playwright. Keep the description in sync with V51.

      if (appUserRepository.count() == 0) {
        Tenant tenant =
            tenantRepository
                .findFirstByOrderByIdAsc()
                .orElseGet(
                    () -> {
                      Tenant t = new Tenant();
                      t.setName("Demo salon");
                      tenantRepository.save(t);
                      return t;
                    });
        seedDemoTenantData(tenant);
      }

        Tier premiumTier = new Tier();
        premiumTier.setName("Premium");
        premiumTier.setDescription("Tier con funcionalidades ampliadas.");
        tierRepository.save(premiumTier);
        log.info("Seeded tier 'Premium'");
      }
    };
  }

  // HU-57: the first-ever Platform Admin is now bootstrapped by PlatformAdminBootstrap, not here
  // — that bean runs on every boot regardless of femme.data-init.enabled (production never sets
  // that flag but still needs a way in), unlike this bean which stays opt-in dev/e2e-only. See
  // PlatformAdminBootstrap's javadoc and the PRD's "Sin seed hardcodeado" definition.
  @Bean
  @Profile("!test")
  CommandLineRunner platformAdminBootstrapRunner(PlatformAdminBootstrap platformAdminBootstrap) {
    return args -> platformAdminBootstrap.bootstrapIfNeeded();
  }

  public void seedDemoTenantData(Tenant tenant) {
    if (appUserRepository.findByEmail("isabelzymanscki@gmail.com").isEmpty()) {
      AppUser user = new AppUser();
      user.setTenant(tenant);
      user.setEmail("isabelzymanscki@gmail.com");
      user.setPasswordHash(passwordEncoder.encode("Demo123!"));
      user.setRole(UserRole.ADMIN);
      appUserRepository.save(user);
    }

    if (!businessProfileRepository.existsById(tenant.getId())) {
      BusinessProfile profile = new BusinessProfile();
      profile.setTenant(tenant);
      profile.setBusinessName(tenant.getName());
      businessProfileRepository.save(profile);
    }

    if (fiscalStampRepository.countByTenant_Id(tenant.getId()) == 0) {
      LocalDate today = LocalDate.now();
      FiscalStamp stamp = new FiscalStamp();
      stamp.setTenant(tenant);
      stamp.setStampNumber("12345678");
      stamp.setValidFrom(today.minusYears(1));
      stamp.setValidUntil(today.plusYears(2));
      stamp.setRangeFrom(1);
      stamp.setRangeTo(9_999_999);
      stamp.setNextEmissionNumber(1);
      stamp.setActive(true);
      stamp.setLockedAfterInvoice(false);
      fiscalStampRepository.save(stamp);
    }

    log.info(
        "Seeded demo admin user isabelzymanscki@gmail.com (password Demo123!) on tenant id={}",
        tenant.getId());
  }
}
