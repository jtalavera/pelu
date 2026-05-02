package com.cursorpoc.backend.bootstrap;

import com.cursorpoc.backend.config.FemmeSystemAdminProperties;
import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.BusinessProfile;
import com.cursorpoc.backend.domain.FeatureFlag;
import com.cursorpoc.backend.domain.FiscalStamp;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.ServiceCategory;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import com.cursorpoc.backend.repository.FeatureFlagRepository;
import com.cursorpoc.backend.repository.FiscalStampRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.repository.ServiceCategoryRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.Map;
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
      FiscalStampRepository fiscalStampRepository,
      FeatureFlagRepository featureFlagRepository,
      ServiceCategoryRepository serviceCategoryRepository,
      SalonServiceRepository salonServiceRepository,
      ProfessionalRepository professionalRepository,
      FemmeSystemAdminProperties systemAdminProperties,
      PasswordEncoder passwordEncoder) {
    return args -> {
      if (featureFlagRepository.findByFlagKey("GUIDED_TOUR").isEmpty()) {
        FeatureFlag guidedTour = new FeatureFlag();
        guidedTour.setFlagKey("GUIDED_TOUR");
        guidedTour.setEnabled(true);
        guidedTour.setDescription("Show guided tour tooltips on every screen");
        featureFlagRepository.save(guidedTour);
        log.info("Seeded feature flag GUIDED_TOUR (enabled=true)");
      }

      seedDemoTenantIfNoUsers(
          tenantRepository,
          appUserRepository,
          businessProfileRepository,
          fiscalStampRepository,
          passwordEncoder);

      tenantRepository
          .findFirstByOrderByIdAsc()
          .ifPresent(
              tenant ->
                  seedBootstrapCatalogIfEmpty(
                      tenant,
                      serviceCategoryRepository,
                      salonServiceRepository,
                      professionalRepository));

      var systemEmail = systemAdminProperties.getEmail().trim().toLowerCase();
      if (appUserRepository.findByEmail(systemEmail).isEmpty()) {
        tenantRepository
            .findById(systemAdminProperties.getTenantId())
            .ifPresentOrElse(
                t -> {
                  AppUser root = new AppUser();
                  root.setTenant(t);
                  root.setEmail(systemEmail);
                  root.setPasswordHash(passwordEncoder.encode(systemAdminProperties.getPassword()));
                  root.setRole(UserRole.SYSTEM_ADMIN);
                  appUserRepository.save(root);
                  log.info("Seeded system admin user {} on tenant id={}", systemEmail, t.getId());
                },
                () ->
                    log.warn(
                        "Skipped system admin seed: no tenant with id={}",
                        systemAdminProperties.getTenantId()));
      }
    };
  }

  private void seedDemoTenantIfNoUsers(
      TenantRepository tenantRepository,
      AppUserRepository appUserRepository,
      BusinessProfileRepository businessProfileRepository,
      FiscalStampRepository fiscalStampRepository,
      PasswordEncoder passwordEncoder) {
    if (appUserRepository.count() != 0) {
      return;
    }

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

    if (appUserRepository.findByEmail("admin@demo.com").isEmpty()) {
      AppUser user = new AppUser();
      user.setTenant(tenant);
      user.setEmail("admin@demo.com");
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
        "Seeded demo admin user admin@demo.com (password Demo123!) on tenant id={}",
        tenant.getId());
  }

  private void seedBootstrapCatalogIfEmpty(
      Tenant tenant,
      ServiceCategoryRepository serviceCategoryRepository,
      SalonServiceRepository salonServiceRepository,
      ProfessionalRepository professionalRepository) {
    Long tenantId = tenant.getId();
    if (tenantId == null) {
      return;
    }
    if (serviceCategoryRepository.countByTenant_Id(tenantId) > 0
        || salonServiceRepository.countByTenant_Id(tenantId) > 0
        || professionalRepository.countByTenant_Id(tenantId) > 0) {
      return;
    }

    Map<String, ServiceCategory> categoriesByName = new HashMap<>();
    for (String categoryName : FemmeSalonCatalogBootstrapData.CATEGORY_NAMES) {
      ServiceCategory category = new ServiceCategory();
      category.setTenant(tenant);
      category.setName(categoryName);
      category.setActive(true);
      category.setAccentKey("stone");
      serviceCategoryRepository.save(category);
      categoriesByName.put(categoryName, category);
    }

    for (FemmeSalonCatalogBootstrapData.ServiceRow row : FemmeSalonCatalogBootstrapData.SERVICES) {
      ServiceCategory category = categoriesByName.get(row.categoryName());
      if (category == null) {
        throw new IllegalStateException("Missing seeded category for service=" + row.name());
      }
      SalonService service = new SalonService();
      service.setTenant(tenant);
      service.setCategory(category);
      service.setName(row.name());
      service.setPriceMinor(row.priceMinor());
      service.setDurationMinutes(FemmeSalonCatalogBootstrapData.DEFAULT_SERVICE_DURATION_MINUTES);
      service.setActive(true);
      salonServiceRepository.save(service);
    }

    for (FemmeSalonCatalogBootstrapData.ProfessionalRow row :
        FemmeSalonCatalogBootstrapData.PROFESSIONALS) {
      Professional professional = new Professional();
      professional.setTenant(tenant);
      professional.setFullName(row.fullName());
      professional.setActive(true);
      professional.setSystemAccessAllowed(false);
      professionalRepository.save(professional);
    }

    log.info(
        "Seeded hard-coded salon catalog for tenant id={} (categories={}, services={}, professionals={})",
        tenantId,
        FemmeSalonCatalogBootstrapData.CATEGORY_NAMES.size(),
        FemmeSalonCatalogBootstrapData.SERVICES.size(),
        FemmeSalonCatalogBootstrapData.PROFESSIONALS.size());
  }
}
