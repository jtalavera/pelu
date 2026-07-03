package com.cursorpoc.backend.bootstrap;

import com.cursorpoc.backend.config.FemmeSystemAdminProperties;
import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.BusinessProfile;
import com.cursorpoc.backend.domain.Client;
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
import com.cursorpoc.backend.repository.ClientRepository;
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
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
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

  private static final String SERVICES_SEED_CSV = "seed/servicios_peluqueria_normalizado.csv";
  private static final String CLIENTS_SEED_CSV = "seed/clientes_filtrado_v2.csv";

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
  private final ClientRepository clientRepository;
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
      ClientRepository clientRepository,
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
    this.clientRepository = clientRepository;
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

      tenantRepository.findFirstByOrderByIdAsc().ifPresent(tenant -> seedCatalogFromCsv(tenant));

      tenantRepository.findFirstByOrderByIdAsc().ifPresent(tenant -> seedClientsFromCsv(tenant));

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

  /**
   * Reconciles service categories and services for the tenant against the authoritative CSV ({@code
   * seed/servicios_peluqueria_normalizado.csv}): categories/services present in the CSV but missing
   * in the DB are created; categories/services present in the DB but absent from the CSV are
   * deleted. Professionals are seeded separately and only if none exist yet.
   */
  public void seedCatalogFromCsv(Tenant tenant) {
    Long tenantId = tenant.getId();
    if (tenantId == null) {
      return;
    }

    Tax defaultTax = seedDefaultTaxesIfAbsent(tenant);

    List<ServiceCsvRow> csvRows = readServiceCsvRows();

    LinkedHashSet<String> desiredCategoryNames = new LinkedHashSet<>();
    LinkedHashMap<String, ServiceCsvRow> desiredServices = new LinkedHashMap<>();
    for (ServiceCsvRow row : csvRows) {
      desiredCategoryNames.add(row.categoryName());
      desiredServices.putIfAbsent(serviceKey(row.name(), row.categoryName()), row);
    }

    Map<String, ServiceCategory> categoriesByName = new LinkedHashMap<>();
    int createdCategories = 0;
    for (String categoryName : desiredCategoryNames) {
      ServiceCategory category =
          serviceCategoryRepository.findByNameAndTenant_Id(categoryName, tenantId).orElse(null);
      if (category == null) {
        category = new ServiceCategory();
        category.setTenant(tenant);
        category.setName(categoryName);
        category.setActive(true);
        category.setAccentKey("stone");
        category = serviceCategoryRepository.save(category);
        createdCategories++;
      }
      categoriesByName.put(categoryName, category);
    }

    List<SalonService> existingServices =
        salonServiceRepository.findByTenant_IdOrderByNameAsc(tenantId);
    Set<String> existingServiceKeys = new HashSet<>();
    int deletedServices = 0;
    for (SalonService service : existingServices) {
      String key = serviceKey(service.getName(), service.getCategory().getName());
      if (desiredServices.containsKey(key)) {
        existingServiceKeys.add(key);
      } else {
        salonServiceRepository.delete(service);
        deletedServices++;
      }
    }

    int insertedServices = 0;
    for (ServiceCsvRow row : desiredServices.values()) {
      String key = serviceKey(row.name(), row.categoryName());
      if (existingServiceKeys.contains(key)) {
        continue;
      }
      SalonService service = new SalonService();
      service.setTenant(tenant);
      service.setCategory(categoriesByName.get(row.categoryName()));
      service.setTax(defaultTax);
      service.setName(row.name());
      service.setPriceMinor(BigDecimal.ZERO);
      service.setDurationMinutes(FemmeSalonCatalogBootstrapData.DEFAULT_SERVICE_DURATION_MINUTES);
      service.setActive(true);
      salonServiceRepository.save(service);
      insertedServices++;
    }

    // Now that stale services have been removed, orphan categories (absent from the CSV) have no
    // remaining services and can be safely deleted.
    List<ServiceCategory> existingCategories =
        serviceCategoryRepository.findByTenant_IdOrderByNameAsc(tenantId);
    int deletedCategories = 0;
    for (ServiceCategory category : existingCategories) {
      if (!desiredCategoryNames.contains(category.getName())) {
        serviceCategoryRepository.delete(category);
        deletedCategories++;
      }
    }

    seedProfessionalsIfEmpty(tenant);

    log.info(
        "Reconciled salon catalog from CSV for tenant id={}: categories total={} (created={},"
            + " removed={}), services total={} (inserted={}, removed={})",
        tenantId,
        desiredCategoryNames.size(),
        createdCategories,
        deletedCategories,
        desiredServices.size(),
        insertedServices,
        deletedServices);
  }

  private void seedProfessionalsIfEmpty(Tenant tenant) {
    Long tenantId = tenant.getId();
    if (tenantId == null || professionalRepository.countByTenant_Id(tenantId) > 0) {
      return;
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
        "Seeded {} professionals for tenant id={}",
        FemmeSalonCatalogBootstrapData.PROFESSIONALS.size(),
        tenantId);
  }

  private static String serviceKey(String name, String categoryName) {
    return name + ' ' + categoryName;
  }

  /**
   * Reads {@code nombre,categoria,precio} rows from the services seed CSV. Category and price are
   * always the last two comma-separated fields; the service name is everything before them, which
   * may itself contain commas when quoted (e.g. {@code "CASTAÑO CAOBA CENIZA 4,51",Coloración,0}).
   */
  private List<ServiceCsvRow> readServiceCsvRows() {
    List<ServiceCsvRow> rows = new ArrayList<>();
    ClassPathResource csv = new ClassPathResource(SERVICES_SEED_CSV);
    try (BufferedReader reader =
        new BufferedReader(new InputStreamReader(csv.getInputStream(), StandardCharsets.UTF_8))) {
      String line = reader.readLine();
      if (line != null && line.startsWith("﻿")) {
        line = line.substring(1);
      }
      // skip header line, now read data rows
      while ((line = reader.readLine()) != null) {
        if (line.isBlank()) {
          continue;
        }
        int lastComma = line.lastIndexOf(',');
        if (lastComma < 0) {
          continue;
        }
        String rest = line.substring(0, lastComma);
        int secondLastComma = rest.lastIndexOf(',');
        if (secondLastComma < 0) {
          continue;
        }
        String categoryName = rest.substring(secondLastComma + 1).trim();
        String name = unquoteCsvField(rest.substring(0, secondLastComma));
        if (name.isEmpty() || categoryName.isEmpty()) {
          continue;
        }
        rows.add(new ServiceCsvRow(name, categoryName));
      }
    } catch (IOException e) {
      log.error("Failed to read service seed CSV: {}", e.getMessage());
    }
    return rows;
  }

  private static String unquoteCsvField(String field) {
    String trimmed = field.trim();
    if (trimmed.length() >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
      trimmed = trimmed.substring(1, trimmed.length() - 1).replace("\"\"", "\"");
    }
    return trimmed;
  }

  /**
   * Reconciles clients for the tenant against the authoritative CSV ({@code
   * seed/clientes_filtrado_v2.csv}): clients present in the CSV but missing in the DB are created;
   * clients present in the DB but absent from the CSV are deleted.
   */
  public void seedClientsFromCsv(Tenant tenant) {
    Long tenantId = tenant.getId();
    if (tenantId == null) {
      return;
    }

    LinkedHashMap<String, ClientCsvRow> desiredClients = readClientCsvRows();
    if (desiredClients.isEmpty()) {
      return;
    }

    List<Client> existingClients = clientRepository.findByTenant_Id(tenantId);
    Set<String> existingNames = new HashSet<>();
    int deleted = 0;
    for (Client client : existingClients) {
      if (desiredClients.containsKey(client.getFullName())) {
        existingNames.add(client.getFullName());
      } else {
        clientRepository.delete(client);
        deleted++;
      }
    }

    int inserted = 0;
    for (ClientCsvRow row : desiredClients.values()) {
      if (existingNames.contains(row.fullName())) {
        continue;
      }
      Client client = new Client();
      client.setTenant(tenant);
      client.setFullName(row.fullName());
      client.setActive(row.active());
      client.setVisitCount(0);
      clientRepository.save(client);
      inserted++;
    }

    log.info(
        "Reconciled clients from CSV for tenant id={}: total={} (inserted={}, removed={})",
        tenantId,
        desiredClients.size(),
        inserted,
        deleted);
  }

  /** Reads {@code Descripcion;Estado} rows from the clients seed CSV, deduplicated by name. */
  private LinkedHashMap<String, ClientCsvRow> readClientCsvRows() {
    LinkedHashMap<String, ClientCsvRow> rows = new LinkedHashMap<>();
    ClassPathResource csv = new ClassPathResource(CLIENTS_SEED_CSV);
    try (BufferedReader reader =
        new BufferedReader(new InputStreamReader(csv.getInputStream(), StandardCharsets.UTF_8))) {
      String line = reader.readLine();
      if (line != null && line.startsWith("﻿")) {
        line = line.substring(1);
      }
      // skip header line, now read data rows
      while ((line = reader.readLine()) != null) {
        if (line.isBlank()) {
          continue;
        }
        String[] parts = line.split(";", -1);
        if (parts.length < 2) {
          continue;
        }
        String fullName = parts[0].trim();
        if (fullName.isEmpty()) {
          continue;
        }
        boolean active = "ACTIVO".equalsIgnoreCase(parts[1].trim());
        rows.putIfAbsent(fullName, new ClientCsvRow(fullName, active));
      }
    } catch (IOException e) {
      log.error("Failed to read client seed CSV: {}", e.getMessage());
    }
    return rows;
  }

  private record ServiceCsvRow(String name, String categoryName) {}

  private record ClientCsvRow(String fullName, boolean active) {}
}
