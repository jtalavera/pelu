package com.cursorpoc.backend.stock;

import com.cursorpoc.backend.domain.StockTenantLink;
import com.cursorpoc.backend.repository.StockTenantLinkRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.service.FeatureFlagService;
import java.util.Collection;
import java.util.Map;
import java.util.TreeMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * Stock integration (HU-61): keeps control-stock's copy of each tenant's {@code STOCK_*} flags in
 * step with pelu. Flags resolve exactly like every other flag (global AND tier AND tenant) — this
 * class only reacts to the result:
 *
 * <ul>
 *   <li>First time {@code STOCK_MODULE} resolves ON for a tenant: enqueue, in order, {@code
 *       TENANT_UPSERT} → {@code FEATURE_FLAGS_SYNC} → {@code CATALOG_FULL_SYNC}.
 *   <li>Afterwards, whenever the resolved {@code STOCK_*} snapshot changes (in either direction):
 *       {@code FEATURE_FLAGS_SYNC} with a version that only goes up. Turning the module back ON
 *       also re-sends the full catalog, which may have changed while it was off.
 *   <li>A rename or status change of a linked tenant: {@code TENANT_UPSERT}.
 * </ul>
 */
@Component
public class StockFeatureFlagPublisher {

  private static final Logger log = LoggerFactory.getLogger(StockFeatureFlagPublisher.class);

  public static final String PREFIX = "STOCK_";

  private final FeatureFlagService featureFlagService;
  private final StockTenantLinkRepository linkRepository;
  private final TenantRepository tenantRepository;
  private final StockOutboxService outbox;
  private final StockPayloads payloads;
  private final ObjectMapper objectMapper;

  public StockFeatureFlagPublisher(
      FeatureFlagService featureFlagService,
      StockTenantLinkRepository linkRepository,
      TenantRepository tenantRepository,
      StockOutboxService outbox,
      StockPayloads payloads,
      ObjectMapper objectMapper) {
    this.featureFlagService = featureFlagService;
    this.linkRepository = linkRepository;
    this.tenantRepository = tenantRepository;
    this.outbox = outbox;
    this.payloads = payloads;
    this.objectMapper = objectMapper;
  }

  @EventListener
  @Transactional
  public void onFlagsChanged(StockFlagsChangedEvent event) {
    if (!event.relevant()) {
      return;
    }
    Collection<Long> tenants =
        event.tenantIds() != null
            ? event.tenantIds()
            : event.tierId() != null
                ? tenantRepository.findIdsByTierId(event.tierId())
                : tenantRepository.findAllIds();
    for (Long tenantId : tenants) {
      sync(tenantId, event.tenantProfileChanged());
    }
  }

  /** The tenant's resolved {@code STOCK_*} flags, sorted by key. */
  @Transactional(readOnly = true)
  public Map<String, Boolean> resolvedStockFlags(long tenantId) {
    Map<String, Boolean> out = new TreeMap<>();
    featureFlagService
        .resolveAll(tenantId)
        .forEach(
            (key, value) -> {
              if (key.startsWith(PREFIX)) {
                out.put(key, value);
              }
            });
    return out;
  }

  @Transactional
  public void sync(long tenantId, boolean tenantProfileChanged) {
    Map<String, Boolean> flags = resolvedStockFlags(tenantId);
    boolean moduleOn = Boolean.TRUE.equals(flags.get(StockOutboxService.STOCK_MODULE));
    String json = objectMapper.writeValueAsString(flags);
    StockTenantLink link = linkRepository.lockByTenantId(tenantId).orElse(null);
    if (link == null) {
      if (!moduleOn) {
        return;
      }
      link = new StockTenantLink();
      link.setTenantId(tenantId);
      link.setFlagsVersion(1);
      link.setFlagsJson(json);
      linkRepository.save(link);
      log.info("Stock activated for tenantId={}: provisioning", tenantId);
      outbox.enqueueTenantUpsert(tenantId, payloads.tenantUpsert(tenantId));
      outbox.enqueueFlagsSync(tenantId, 1, flags);
      outbox.enqueueCatalogFullSync(tenantId, true);
      return;
    }
    if (tenantProfileChanged) {
      outbox.enqueueTenantUpsert(tenantId, payloads.tenantUpsert(tenantId));
    }
    if (json.equals(link.getFlagsJson())) {
      return;
    }
    boolean wasOn = wasModuleOn(link.getFlagsJson());
    long version = link.getFlagsVersion() + 1;
    link.setFlagsVersion(version);
    link.setFlagsJson(json);
    outbox.enqueueFlagsSync(tenantId, version, flags);
    log.info(
        "Stock flags changed tenantId={} version={} STOCK_MODULE={}", tenantId, version, moduleOn);
    if (moduleOn && !wasOn) {
      outbox.enqueueCatalogFullSync(tenantId, true);
    }
  }

  /** Current flags version for the pull endpoint (0 when the tenant was never linked). */
  @Transactional(readOnly = true)
  public long currentVersion(long tenantId) {
    return linkRepository.findById(tenantId).map(StockTenantLink::getFlagsVersion).orElse(0L);
  }

  @Transactional(readOnly = true)
  public boolean tenantExists(long tenantId) {
    return tenantRepository.existsById(tenantId);
  }

  private boolean wasModuleOn(String json) {
    if (json == null || json.isBlank()) {
      return false;
    }
    try {
      return objectMapper.readTree(json).path(StockOutboxService.STOCK_MODULE).asBoolean(false);
    } catch (RuntimeException e) {
      return false;
    }
  }
}
