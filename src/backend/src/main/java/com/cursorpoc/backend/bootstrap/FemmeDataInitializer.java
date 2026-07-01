package com.cursorpoc.backend.bootstrap;

import com.cursorpoc.backend.config.FemmeSystemAdminProperties;
import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.BusinessProfile;
import com.cursorpoc.backend.domain.FeatureFlag;
import com.cursorpoc.backend.domain.FiscalStamp;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.ProfessionalSchedule;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.ServiceCategory;
import com.cursorpoc.backend.domain.Tax;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import com.cursorpoc.backend.repository.FeatureFlagRepository;
import com.cursorpoc.backend.repository.FiscalStampRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.ProfessionalScheduleRepository;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.repository.ServiceCategoryRepository;
import com.cursorpoc.backend.repository.TaxRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.ClassPathResource;
import org.springframework.security.crypto.password.PasswordEncoder;

@Configuration
public class FemmeDataInitializer {

  private static final Logger log = LoggerFactory.getLogger(FemmeDataInitializer.class);

  private final TenantRepository tenantRepository;
  private final AppUserRepository appUserRepository;
  private final BusinessProfileRepository businessProfileRepository;
  private final FiscalStampRepository fiscalStampRepository;
  private final FeatureFlagRepository featureFlagRepository;
  private final ServiceCategoryRepository serviceCategoryRepository;
  private final SalonServiceRepository salonServiceRepository;
  private final ProfessionalRepository professionalRepository;
  private final ProfessionalScheduleRepository professionalScheduleRepository;
  private final TaxRepository taxRepository;
  private final FemmeSystemAdminProperties systemAdminProperties;
  private final PasswordEncoder passwordEncoder;

  public FemmeDataInitializer(
      TenantRepository tenantRepository,
      AppUserRepository appUserRepository,
      BusinessProfileRepository businessProfileRepository,
      FiscalStampRepository fiscalStampRepository,
      FeatureFlagRepository featureFlagRepository,
      ServiceCategoryRepository serviceCategoryRepository,
      SalonServiceRepository salonServiceRepository,
      ProfessionalRepository professionalRepository,
      ProfessionalScheduleRepository professionalScheduleRepository,
      TaxRepository taxRepository,
      FemmeSystemAdminProperties systemAdminProperties,
      PasswordEncoder passwordEncoder) {
    this.tenantRepository = tenantRepository;
    this.appUserRepository = appUserRepository;
    this.businessProfileRepository = businessProfileRepository;
    this.fiscalStampRepository = fiscalStampRepository;
    this.featureFlagRepository = featureFlagRepository;
    this.serviceCategoryRepository = serviceCategoryRepository;
    this.salonServiceRepository = salonServiceRepository;
    this.professionalRepository = professionalRepository;
    this.professionalScheduleRepository = professionalScheduleRepository;
    this.taxRepository = taxRepository;
    this.systemAdminProperties = systemAdminProperties;
    this.passwordEncoder = passwordEncoder;
  }

  @Bean
  @Profile("!test")
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

      tenantRepository.findFirstByOrderByIdAsc().ifPresent(tenant -> seedCatalogIfEmpty(tenant));

      tenantRepository.findFirstByOrderByIdAsc().ifPresent(tenant -> seedProductsFromCsv(tenant));

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

  public void seedDemoTenantData(Tenant tenant) {
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

  /**
   * Ensures the three standard Paraguayan IVA rates exist for this tenant, then returns IVA 10%.
   */
  private Tax seedDefaultTaxesIfAbsent(Tenant tenant) {
    var existing = taxRepository.findByTenant_IdOrderByNameAsc(tenant.getId());
    if (!existing.isEmpty()) {
      return existing.stream()
          .filter(t -> t.getRate().compareTo(BigDecimal.TEN) == 0)
          .findFirst()
          .orElse(existing.get(0));
    }
    Tax iva10 = new Tax();
    iva10.setTenant(tenant);
    iva10.setName("IVA 10%");
    iva10.setRate(new BigDecimal("10.00"));
    iva10.setActive(true);
    taxRepository.save(iva10);

    Tax iva5 = new Tax();
    iva5.setTenant(tenant);
    iva5.setName("IVA 5%");
    iva5.setRate(new BigDecimal("5.00"));
    iva5.setActive(true);
    taxRepository.save(iva5);

    Tax exento = new Tax();
    exento.setTenant(tenant);
    exento.setName("Exento");
    exento.setRate(BigDecimal.ZERO);
    exento.setActive(true);
    taxRepository.save(exento);

    log.info("Seeded default tax types (IVA 10%, IVA 5%, Exento) for tenant id={}", tenant.getId());
    return iva10;
  }

  public void seedCatalogIfEmpty(Tenant tenant) {
    Long tenantId = tenant.getId();
    if (tenantId == null) {
      return;
    }
    if (serviceCategoryRepository.countByTenant_Id(tenantId) > 0
        || salonServiceRepository.countByTenant_Id(tenantId) > 0
        || professionalRepository.countByTenant_Id(tenantId) > 0) {
      // Ensure tax types exist even if catalog was already seeded
      seedDefaultTaxesIfAbsent(tenant);
      return;
    }

    Tax defaultTax = seedDefaultTaxesIfAbsent(tenant);

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
      service.setTax(defaultTax);
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
      // Issue #39: seed Mon-Sat (days 1-6) 09:00-19:00 for every active professional.
      LocalTime start = LocalTime.of(9, 0);
      LocalTime end = LocalTime.of(19, 0);
      for (short day = 1; day <= 6; day++) {
        ProfessionalSchedule schedule = new ProfessionalSchedule();
        schedule.setProfessional(professional);
        schedule.setDayOfWeek(day);
        schedule.setStartTime(start);
        schedule.setEndTime(end);
        professionalScheduleRepository.save(schedule);
      }
    }

    log.info(
        "Seeded hard-coded salon catalog for tenant id={} (categories={}, services={}, professionals={})",
        tenantId,
        FemmeSalonCatalogBootstrapData.CATEGORY_NAMES.size(),
        FemmeSalonCatalogBootstrapData.SERVICES.size(),
        FemmeSalonCatalogBootstrapData.PROFESSIONALS.size());
  }

  public void seedProductsFromCsv(Tenant tenant) {
    Long tenantId = tenant.getId();
    if (tenantId == null) {
      return;
    }

    ServiceCategory productosCategory =
        serviceCategoryRepository
            .findByNameAndTenant_Id("Productos", tenantId)
            .orElseGet(
                () -> {
                  ServiceCategory cat = new ServiceCategory();
                  cat.setTenant(tenant);
                  cat.setName("Productos");
                  cat.setActive(true);
                  cat.setAccentKey("stone");
                  serviceCategoryRepository.save(cat);
                  log.info("Created 'Productos' service category for tenant id={}", tenantId);
                  return cat;
                });

    Tax defaultTax = seedDefaultTaxesIfAbsent(tenant);

    Set<String> existingNames = new HashSet<>();
    salonServiceRepository.findByTenant_IdOrderByNameAsc(tenantId).stream()
        .filter(s -> s.getCategory().getId().equals(productosCategory.getId()))
        .forEach(s -> existingNames.add(s.getName()));

    ClassPathResource csv = new ClassPathResource("seed/articulos_normalizado.csv");
    int seeded = 0;
    int skipped = 0;
    try (BufferedReader reader =
        new BufferedReader(new InputStreamReader(csv.getInputStream(), StandardCharsets.UTF_8))) {
      String line = reader.readLine();
      // Strip UTF-8 BOM if present
      if (line != null && line.startsWith("﻿")) {
        line = line.substring(1);
      }
      // skip header line, now read data rows
      while ((line = reader.readLine()) != null) {
        if (line.isBlank()) {
          continue;
        }
        String name = line.split(",", -1)[0].trim();
        if (name.isEmpty() || existingNames.contains(name)) {
          skipped++;
          continue;
        }
        SalonService service = new SalonService();
        service.setTenant(tenant);
        service.setCategory(productosCategory);
        service.setTax(defaultTax);
        service.setName(name);
        service.setPriceMinor(FemmeSalonCatalogBootstrapData.DEFAULT_PRICE_MINOR);
        service.setDurationMinutes(FemmeSalonCatalogBootstrapData.DEFAULT_SERVICE_DURATION_MINUTES);
        service.setActive(true);
        salonServiceRepository.save(service);
        existingNames.add(name);
        seeded++;
      }
    } catch (IOException e) {
      log.error("Failed to read product seed CSV: {}", e.getMessage());
      return;
    }
    log.info("Product CSV seed for tenant id={}: seeded={}, skipped={}", tenantId, seeded, skipped);
  }
}
