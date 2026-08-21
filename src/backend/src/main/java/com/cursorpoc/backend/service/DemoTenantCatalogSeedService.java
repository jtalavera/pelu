package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.ServiceCategory;
import com.cursorpoc.backend.domain.Tax;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.repository.ServiceCategoryRepository;
import com.cursorpoc.backend.repository.TaxRepository;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

/**
 * HU-56: reconciles the demo tenant's service catalog and client list against static seed CSVs
 * ({@code servicios_peluqueria_normalizado.csv}, {@code clientes_filtrado_v2.csv}).
 *
 * <p>This class exists <strong>solely</strong> to back {@link SeedResetService}'s e2e/dev-only
 * {@code POST /api/admin/seed/reset} endpoint (itself gated behind {@code femme.data-init.enabled},
 * disabled by default in production — see {@code SeedResetController}). It is deliberately
 * <strong>not</strong> wired into system boot: HU-56 removed the equivalent calls from {@code
 * FemmeDataInitializer}'s {@code CommandLineRunner} so that starting the system never creates,
 * updates or deletes any tenant's clients or services (see PRD "Sin seed hardcodeado"). What
 * remains here is scaffolding for the e2e test suite, which still resets tenant id=1 to a known
 * catalog/client fixture between test runs — HU-58 ("ajustar el entorno e2e") owns replacing this
 * with a seed mechanism that doesn't hardcode a specific tenant's business data.
 */
@Service
public class DemoTenantCatalogSeedService {

  private static final Logger log = LoggerFactory.getLogger(DemoTenantCatalogSeedService.class);

  private static final String SERVICES_SEED_CSV = "seed/servicios_peluqueria_normalizado.csv";
  private static final String CLIENTS_SEED_CSV = "seed/clientes_filtrado_v2.csv";
  private static final int DEFAULT_SERVICE_DURATION_MINUTES = 60;

  private final ServiceCategoryRepository serviceCategoryRepository;
  private final SalonServiceRepository salonServiceRepository;
  private final TaxRepository taxRepository;
  private final ClientRepository clientRepository;
  private final InvoiceRepository invoiceRepository;
  private final AppointmentRepository appointmentRepository;

  public DemoTenantCatalogSeedService(
      ServiceCategoryRepository serviceCategoryRepository,
      SalonServiceRepository salonServiceRepository,
      TaxRepository taxRepository,
      ClientRepository clientRepository,
      InvoiceRepository invoiceRepository,
      AppointmentRepository appointmentRepository) {
    this.serviceCategoryRepository = serviceCategoryRepository;
    this.salonServiceRepository = salonServiceRepository;
    this.taxRepository = taxRepository;
    this.clientRepository = clientRepository;
    this.invoiceRepository = invoiceRepository;
    this.appointmentRepository = appointmentRepository;
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
   * deleted.
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
      service.setDurationMinutes(DEFAULT_SERVICE_DURATION_MINUTES);
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

  private static String serviceKey(String name, String categoryName) {
    return name + ' ' + categoryName;
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
    int skippedInUse = 0;
    for (Client client : existingClients) {
      if (desiredClients.containsKey(client.getFullName())) {
        existingNames.add(client.getFullName());
      } else if (invoiceRepository.existsByClient_Id(client.getId())
          || appointmentRepository.existsByClient_Id(client.getId())) {
        // This client has real invoices/appointments tied to it (created via live usage since
        // the seed CSV was last updated). Deleting it would violate fk_inv_client/fk_appt_client
        // and crash this reconciliation on every call. Keep it instead.
        existingNames.add(client.getFullName());
        skippedInUse++;
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
        "Reconciled clients from CSV for tenant id={}: total={} (inserted={}, removed={},"
            + " skippedInUse={})",
        tenantId,
        desiredClients.size(),
        inserted,
        deleted,
        skippedInUse);
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
