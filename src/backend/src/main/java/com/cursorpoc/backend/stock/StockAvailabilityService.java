package com.cursorpoc.backend.stock;

import com.cursorpoc.backend.config.StockProperties;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.stock.StockApiClient.StockResponse;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

/**
 * Stock integration (HU-66): "how many are left?" for the products on an invoice being drafted. The
 * browser never talks to control-stock: pelu proxies {@code GET /availability} with its own M2M
 * credentials. Purely informative — any failure answers {@code unavailable=true} and invoicing goes
 * on as usual.
 */
@Service
public class StockAvailabilityService {

  private static final Logger log = LoggerFactory.getLogger(StockAvailabilityService.class);

  private final StockOutboxService outbox;
  private final StockApiClient client;
  private final StockProperties properties;
  private final SalonServiceRepository salonServiceRepository;

  public StockAvailabilityService(
      StockOutboxService outbox,
      StockApiClient client,
      StockProperties properties,
      SalonServiceRepository salonServiceRepository) {
    this.outbox = outbox;
    this.client = client;
    this.properties = properties;
    this.salonServiceRepository = salonServiceRepository;
  }

  public record AvailabilityItem(
      long serviceId,
      boolean mapped,
      BigDecimal available,
      BigDecimal onHand,
      String uom,
      Boolean belowMinimum) {}

  public record AvailabilityResponse(
      boolean enabled, boolean unavailable, List<AvailabilityItem> items) {}

  public AvailabilityResponse availability(long tenantId, Collection<Long> serviceIds) {
    if (!outbox.stockEnabled(tenantId)) {
      return new AvailabilityResponse(false, false, List.of());
    }
    if (serviceIds == null || serviceIds.isEmpty()) {
      return new AvailabilityResponse(true, false, List.of());
    }
    List<String> productIds =
        salonServiceRepository.findByTenantIdAndIdIn(tenantId, serviceIds).stream()
            .filter(SalonService::isProduct)
            .map(s -> String.valueOf(s.getId()))
            .toList();
    if (productIds.isEmpty()) {
      return new AvailabilityResponse(true, false, List.of());
    }
    if (!properties.isConfigured()) {
      return new AvailabilityResponse(true, true, List.of());
    }
    try {
      StockResponse response =
          client.availability(
              tenantId, StockPayloads.EXTERNAL_TYPE, productIds, UUID.randomUUID().toString());
      if (!response.isSuccess()) {
        return new AvailabilityResponse(true, true, List.of());
      }
      JsonNode items = client.parse(response.body()).path("items");
      Map<String, AvailabilityItem> byId = new LinkedHashMap<>();
      for (JsonNode item : items) {
        String externalId = item.path("externalId").asString();
        long serviceId;
        try {
          serviceId = Long.parseLong(externalId);
        } catch (NumberFormatException e) {
          continue;
        }
        boolean mapped = item.path("mapped").asBoolean(false);
        byId.put(
            externalId,
            new AvailabilityItem(
                serviceId,
                mapped,
                decimal(item.path("available")),
                decimal(item.path("onHand")),
                item.path("uom").isNull() ? null : item.path("uom").asString(null),
                item.path("belowMinimum").isBoolean()
                    ? item.path("belowMinimum").asBoolean()
                    : null));
      }
      return new AvailabilityResponse(true, false, new ArrayList<>(byId.values()));
    } catch (RuntimeException e) {
      log.warn("Stock availability unavailable tenantId={} error={}", tenantId, e.toString());
      return new AvailabilityResponse(true, true, List.of());
    }
  }

  private static BigDecimal decimal(JsonNode node) {
    if (node == null || node.isMissingNode() || node.isNull()) {
      return null;
    }
    return node.isNumber() ? node.decimalValue() : new BigDecimal(node.asString());
  }
}
