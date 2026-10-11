package com.cursorpoc.backend.stock;

import com.cursorpoc.backend.config.StockProperties;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Stock integration (HU-61/HU-62): builds the JSON bodies control-stock's integration API expects
 * (see control-stock {@code IntegrationDtos}). Catalog items are identified by {@code externalType
 * = "SERVICE"} + {@code externalId = services.id}; only the name, category, SKU and active flag
 * travel — costs, minimums and units are managed in Stock.
 */
@Component
public class StockPayloads {

  public static final String EXTERNAL_TYPE = "SERVICE";

  /** UN/CEFACT "piece/unit" — the base unit products are created with in Stock. */
  public static final String BASE_UOM = "H87";

  public static final String CURRENCY = "PYG";

  private final TenantRepository tenantRepository;
  private final SalonServiceRepository salonServiceRepository;
  private final StockProperties properties;

  public StockPayloads(
      TenantRepository tenantRepository,
      SalonServiceRepository salonServiceRepository,
      StockProperties properties) {
    this.tenantRepository = tenantRepository;
    this.salonServiceRepository = salonServiceRepository;
    this.properties = properties;
  }

  public Map<String, Object> tenantUpsert(Tenant tenant) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("name", tenant.getName());
    body.put("status", tenant.getStatus() != null ? tenant.getStatus().name() : "ACTIVE");
    body.put("settings", Map.of("currency", CURRENCY));
    return body;
  }

  @Transactional(readOnly = true)
  public Map<String, Object> tenantUpsert(long tenantId) {
    return tenantUpsert(tenantRepository.findById(tenantId).orElseThrow());
  }

  public Map<String, Object> catalogItem(SalonService service) {
    Map<String, Object> item = new LinkedHashMap<>();
    item.put("externalType", EXTERNAL_TYPE);
    item.put("externalId", String.valueOf(service.getId()));
    item.put("name", service.getName());
    item.put("category", service.getCategory() != null ? service.getCategory().getName() : null);
    item.put("baseUom", BASE_UOM);
    item.put("sku", blankToNull(service.getSku()));
    item.put("active", service.isActive() && service.isProduct());
    return item;
  }

  /** Every product of the tenant (active or not), read at delivery time for a full sync. */
  @Transactional(readOnly = true)
  public List<Map<String, Object>> catalogItems(long tenantId) {
    return salonServiceRepository.findProductsByTenantId(tenantId).stream()
        .map(this::catalogItem)
        .toList();
  }

  public Map<String, Object> bulkUpsert(List<Map<String, Object>> items) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("sourceSystem", properties.getSourceSystem());
    body.put("items", items);
    return body;
  }

  private static String blankToNull(String value) {
    return value == null || value.isBlank() ? null : value.trim();
  }
}
