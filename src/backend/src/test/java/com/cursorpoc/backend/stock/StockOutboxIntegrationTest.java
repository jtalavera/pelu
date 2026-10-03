package com.cursorpoc.backend.stock;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.domain.FeatureFlag;
import com.cursorpoc.backend.domain.FiscalStamp;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.InvoiceLine;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.ServiceCategory;
import com.cursorpoc.backend.domain.StockOutboxEvent;
import com.cursorpoc.backend.domain.StockTenantLink;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.Tier;
import com.cursorpoc.backend.domain.enums.ServiceKind;
import com.cursorpoc.backend.domain.enums.StockEventType;
import com.cursorpoc.backend.domain.enums.StockOutboxStatus;
import com.cursorpoc.backend.domain.enums.TenantStatus;
import com.cursorpoc.backend.repository.FeatureFlagRepository;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.repository.ServiceCategoryRepository;
import com.cursorpoc.backend.repository.StockOutboxEventRepository;
import com.cursorpoc.backend.repository.StockTenantLinkRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.repository.TierRepository;
import com.cursorpoc.backend.service.FeatureFlagService;
import com.cursorpoc.backend.web.dto.FeatureGlobalUpdateRequest;
import com.cursorpoc.backend.web.dto.TenantFeatureFlagOverrideRequest;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Stock integration (HU-60..HU-64): the outbox end to end inside a real Spring context (H2) against
 * {@link FakeStockServer}. The wake-up queue is replaced by a recorder so each test drives {@link
 * StockOutboxProcessor} deterministically.
 */
@SpringBootTest
@ActiveProfiles("test")
class StockOutboxIntegrationTest {

  static final FakeStockServer FAKE;

  static {
    try {
      FAKE = new FakeStockServer();
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  @DynamicPropertySource
  static void stockProperties(DynamicPropertyRegistry registry) {
    // Own in-memory database: this context's create-drop must not touch other test contexts'.
    registry.add(
        "spring.datasource.url",
        () ->
            "jdbc:h2:mem:stock_outbox_it;MODE=MSSQLServer;DATABASE_TO_LOWER=TRUE;"
                + "DEFAULT_NULL_ORDERING=HIGH");
    registry.add("app.femme.stock.enabled", () -> "true");
    registry.add("app.femme.stock.base-url", FAKE::baseUrl);
    registry.add("app.femme.stock.client-secret", () -> "test-secret");
    registry.add("app.femme.stock.retry-delays", () -> "1m,5m");
    registry.add("app.femme.stock.reconciler-initial-delay", () -> "3600000");
    registry.add("app.femme.stock.reconciler-interval", () -> "3600000");
  }

  @AfterAll
  static void stopFake() {
    FAKE.close();
  }

  /** Records wake-ups instead of processing them on a background thread. */
  static class RecordingQueue implements StockOutboxQueue {
    final List<Long> woken = new CopyOnWriteArrayList<>();

    @Override
    public void wake(long tenantId, String correlationId) {
      woken.add(tenantId);
    }
  }

  @TestConfiguration
  static class Config {
    @Bean
    @Primary
    RecordingQueue recordingQueue() {
      return new RecordingQueue();
    }
  }

  @Autowired RecordingQueue queue;
  @Autowired StockOutboxProcessor processor;
  @Autowired StockOutboxService outbox;
  @Autowired StockOutboxReconciler reconciler;
  @Autowired StockAdminService admin;
  @Autowired StockFeatureFlagPublisher publisher;
  @Autowired FeatureFlagService featureFlagService;
  @Autowired StockOutboxEventRepository events;
  @Autowired StockTenantLinkRepository links;
  @Autowired TenantRepository tenants;
  @Autowired TierRepository tiers;
  @Autowired FeatureFlagRepository flags;
  @Autowired ServiceCategoryRepository categories;
  @Autowired SalonServiceRepository services;
  @Autowired TransactionTemplate tx;
  @Autowired ObjectMapper objectMapper;

  Tenant tenant;
  SalonService product;
  SalonService haircut;

  @BeforeEach
  void setUp() {
    FAKE.failNextCalls = 0;
    ensureFlag("STOCK_MODULE", true);
    ensureFlag("STOCK_PHYSICAL_COUNT", true);
    ensureFlag("STOCK_TOURS", true);
    ensureFlag("GUIDED_TOUR", true);
    Tier tier = new Tier();
    tier.setName("Tier " + UUID.randomUUID());
    tiers.save(tier);
    tenant = new Tenant();
    tenant.setName("Salón " + UUID.randomUUID());
    tenant.setTier(tier);
    tenant.setStatus(TenantStatus.ACTIVE);
    tenants.save(tenant);
    ServiceCategory cat = new ServiceCategory();
    cat.setTenant(tenant);
    cat.setName("Productos");
    cat.setActive(true);
    cat.setAccentKey("stone");
    categories.save(cat);
    product = service(cat, "Shampoo 300 ml", ServiceKind.PRODUCT, "SH-300");
    haircut = service(cat, "Corte", ServiceKind.SERVICE, null);
    queue.woken.clear();
  }

  private SalonService service(ServiceCategory cat, String name, ServiceKind kind, String sku) {
    SalonService s = new SalonService();
    s.setTenant(tenant);
    s.setCategory(cat);
    s.setName(name);
    s.setPriceMinor(new BigDecimal("50000"));
    s.setDurationMinutes(1);
    s.setActive(true);
    s.setKind(kind);
    s.setSku(sku);
    return services.save(s);
  }

  private void ensureFlag(String key, boolean enabled) {
    FeatureFlag flag = flags.findByFlagKey(key).orElseGet(FeatureFlag::new);
    flag.setFlagKey(key);
    flag.setEnabled(enabled);
    flags.save(flag);
  }

  private List<StockOutboxEvent> tenantEvents() {
    return events.findByTenantIdOrderByIdAsc(tenant.getId());
  }

  private Invoice invoice(long id, int productQty) {
    Invoice invoice = new Invoice();
    invoice.setId(id);
    invoice.setTenant(tenant);
    invoice.setInvoiceNumber(123);
    invoice.setIssuedAt(Instant.parse("2026-10-01T15:00:00Z"));
    FiscalStamp stamp = new FiscalStamp();
    stamp.setEstablishment(1);
    stamp.setExpeditionPoint(2);
    invoice.setFiscalStamp(stamp);
    InvoiceLine productLine = new InvoiceLine();
    productLine.setSalonService(product);
    productLine.setQuantity(productQty);
    invoice.getLines().add(productLine);
    InvoiceLine serviceLine = new InvoiceLine();
    serviceLine.setSalonService(haircut);
    serviceLine.setQuantity(1);
    invoice.getLines().add(serviceLine);
    return invoice;
  }

  /** Links the tenant (as if activated) without going through the publisher. */
  private void linkTenant() {
    StockTenantLink link = new StockTenantLink();
    link.setTenantId(tenant.getId());
    link.setFlagsVersion(1);
    links.save(link);
    FAKE.provisionedTenants.add(String.valueOf(tenant.getId()));
  }

  // ── HU-61: activation ───────────────────────────────────────────────────────────────────────

  @Test
  void firstActivationEnqueuesTenantFlagsAndCatalogInOrderAndDeliversThem() {
    publisher.sync(tenant.getId(), false);

    assertThat(tenantEvents())
        .extracting(StockOutboxEvent::getEventType)
        .containsExactly(
            StockEventType.TENANT_UPSERT,
            StockEventType.FEATURE_FLAGS_SYNC,
            StockEventType.CATALOG_FULL_SYNC);

    processor.processTenant(tenant.getId(), "corr");

    String tid = String.valueOf(tenant.getId());
    assertThat(tenantEvents()).allMatch(e -> e.getStatus() == StockOutboxStatus.DONE);
    List<FakeStockServer.Recorded> calls =
        FAKE.requests.stream()
            .filter(r -> r.path().contains("/tenants/" + tid) || tid.equals(r.tenantHeader()))
            .toList();
    assertThat(calls)
        .extracting(FakeStockServer.Recorded::path)
        .containsExactly(
            "/api/v1/integration/tenants/" + tid,
            "/api/v1/integration/tenants/" + tid + "/feature-flags",
            "/api/v1/integration/items:bulk-upsert");
    JsonNode tenantBody = objectMapper.readTree(calls.get(0).body());
    assertThat(tenantBody.path("name").asString()).isEqualTo(tenant.getName());
    assertThat(tenantBody.path("settings").path("currency").asString()).isEqualTo("PYG");
    JsonNode flagsBody = objectMapper.readTree(calls.get(1).body());
    assertThat(flagsBody.path("version").asLong()).isEqualTo(1);
    assertThat(flagsBody.path("flags").path("STOCK_MODULE").asBoolean()).isTrue();
    assertThat(flagsBody.path("flags").has("GUIDED_TOUR")).isFalse();
    JsonNode items = objectMapper.readTree(calls.get(2).body()).path("items");
    assertThat(items).hasSize(1);
    assertThat(items.get(0).path("externalType").asString()).isEqualTo("SERVICE");
    assertThat(items.get(0).path("externalId").asString())
        .isEqualTo(String.valueOf(product.getId()));
    assertThat(items.get(0).path("baseUom").asString()).isEqualTo("H87");
    assertThat(items.get(0).path("sku").asString()).isEqualTo("SH-300");

    StockTenantLink link = links.findById(tenant.getId()).orElseThrow();
    assertThat(link.getProvisionedAt()).isNotNull();
    assertThat(link.getCatalogSyncedAt()).isNotNull();
  }

  @Test
  void tenantWithoutStockModuleIsNeverLinkedNorGetsEvents() {
    tx.executeWithoutResult(
        s ->
            featureFlagService.upsertTenantOverride(
                tenant.getId(),
                "STOCK_MODULE",
                new TenantFeatureFlagOverrideRequest(false),
                1L,
                "root@pelu"));

    assertThat(links.findById(tenant.getId())).isEmpty();
    boolean enqueued = tx.execute(s -> outbox.enqueueSale(invoice(9_001L, 1)));
    assertThat(enqueued).isFalse();
    assertThat(tenantEvents()).isEmpty();
  }

  @Test
  void laterStockFlagChangesPushANewVersionAndOtherFlagsDoNot() {
    publisher.sync(tenant.getId(), false);
    int before = tenantEvents().size();

    tx.executeWithoutResult(
        s ->
            featureFlagService.upsertTenantOverride(
                tenant.getId(),
                "STOCK_TOURS",
                new TenantFeatureFlagOverrideRequest(false),
                1L,
                "root@pelu"));
    tx.executeWithoutResult(
        s ->
            featureFlagService.upsertTenantOverride(
                tenant.getId(),
                "GUIDED_TOUR",
                new TenantFeatureFlagOverrideRequest(false),
                1L,
                "root@pelu"));

    List<StockOutboxEvent> after = tenantEvents();
    assertThat(after).hasSize(before + 1);
    StockOutboxEvent sync = after.get(after.size() - 1);
    assertThat(sync.getEventType()).isEqualTo(StockEventType.FEATURE_FLAGS_SYNC);
    JsonNode body = objectMapper.readTree(sync.getPayloadJson());
    assertThat(body.path("version").asLong()).isEqualTo(2);
    assertThat(body.path("flags").path("STOCK_TOURS").asBoolean()).isFalse();

    // Turning the module off is pushed too (Stock must learn it), with a higher version.
    tx.executeWithoutResult(
        s ->
            featureFlagService.upsertTenantOverride(
                tenant.getId(),
                "STOCK_MODULE",
                new TenantFeatureFlagOverrideRequest(false),
                1L,
                "root@pelu"));
    StockOutboxEvent off = tenantEvents().get(tenantEvents().size() - 1);
    assertThat(objectMapper.readTree(off.getPayloadJson()).path("version").asLong()).isEqualTo(3);
    assertThat(publisher.currentVersion(tenant.getId())).isEqualTo(3);
  }

  @Test
  void globalFlagChangeReachesLinkedTenants() {
    publisher.sync(tenant.getId(), false);
    int before = tenantEvents().size();
    try {
      tx.executeWithoutResult(
          s ->
              featureFlagService.updateGlobal(
                  "STOCK_PHYSICAL_COUNT", new FeatureGlobalUpdateRequest(false, null)));
      List<StockOutboxEvent> after = tenantEvents();
      assertThat(after).hasSize(before + 1);
      assertThat(after.get(after.size() - 1).getEventType())
          .isEqualTo(StockEventType.FEATURE_FLAGS_SYNC);
    } finally {
      ensureFlag("STOCK_PHYSICAL_COUNT", true);
    }
  }

  // ── HU-63/HU-64: sale, reversal, correction ─────────────────────────────────────────────────

  @Test
  void saleCarriesOnlyProductLinesAndTheFormattedDocumentNumber() {
    linkTenant();
    tx.executeWithoutResult(s -> outbox.enqueueSale(invoice(5_001L, 3)));

    StockOutboxEvent sale = tenantEvents().get(0);
    assertThat(sale.getIdempotencyKey()).isEqualTo("PELU:INVOICE:5001:0");
    JsonNode body = objectMapper.readTree(sale.getPayloadJson());
    assertThat(body.path("timing").asString()).isEqualTo("POST_SALE");
    assertThat(body.path("reason").asString()).isEqualTo("SALE");
    assertThat(body.path("source").path("docId").asString()).isEqualTo("5001");
    assertThat(body.path("source").path("docNumber").asString()).isEqualTo("001-002-0000123");
    assertThat(body.path("lines")).hasSize(1);
    assertThat(body.path("lines").get(0).path("externalId").asString())
        .isEqualTo(String.valueOf(product.getId()));
    assertThat(body.path("lines").get(0).path("quantity").asInt()).isEqualTo(3);
    assertThat(queue.woken).contains(tenant.getId());

    processor.processTenant(tenant.getId(), "c");
    StockOutboxEvent done = events.findById(sale.getId()).orElseThrow();
    assertThat(done.getStatus()).isEqualTo(StockOutboxStatus.DONE);
    // NEGATIVE_STOCK warnings returned by Stock are kept on the event.
    assertThat(done.getResponseJson()).contains("NEGATIVE_STOCK");
  }

  @Test
  void invoiceWithoutProductsEnqueuesNothingAndItsVoidNeither() {
    linkTenant();
    Invoice onlyServices = invoice(5_002L, 0);
    tx.executeWithoutResult(
        s -> {
          assertThat(outbox.enqueueSale(onlyServices)).isFalse();
          assertThat(outbox.enqueueReverse(onlyServices, "x")).isFalse();
        });
    assertThat(tenantEvents()).isEmpty();
  }

  @Test
  void correctionReversesThePreviousSaleAndPostsTheNextRevision() {
    linkTenant();
    Invoice inv = invoice(5_003L, 1);
    tx.executeWithoutResult(s -> outbox.enqueueSale(inv));
    tx.executeWithoutResult(
        s -> {
          outbox.enqueueReverse(inv, "Comprobante corregido");
          outbox.enqueueSale(inv);
        });
    tx.executeWithoutResult(s -> outbox.enqueueReverse(inv, "Anulado"));
    // A second void path (e.g. SIFEN cancellation after a manual void) adds nothing more.
    tx.executeWithoutResult(s -> assertThat(outbox.enqueueReverse(inv, "again")).isFalse());

    assertThat(tenantEvents())
        .extracting(StockOutboxEvent::getIdempotencyKey)
        .containsExactly(
            "PELU:INVOICE:5003:0",
            "PELU:INVOICE:5003:REVERSE:0",
            "PELU:INVOICE:5003:1",
            "PELU:INVOICE:5003:REVERSE:1");

    processor.processTenant(tenant.getId(), "c");
    assertThat(tenantEvents()).allMatch(e -> e.getStatus() == StockOutboxStatus.DONE);
    assertThat(
            FAKE.requests.stream()
                .filter(r -> String.valueOf(tenant.getId()).equals(r.tenantHeader()))
                .map(FakeStockServer.Recorded::path)
                .toList())
        .containsExactly(
            "/api/v1/integration/documents",
            "/api/v1/integration/documents:reverse",
            "/api/v1/integration/documents",
            "/api/v1/integration/documents:reverse");
  }

  // ── HU-60: reliability ──────────────────────────────────────────────────────────────────────

  @Test
  void stockDownSchedulesARetryAndKeepsTheReversalBehindTheSale() {
    linkTenant();
    Invoice inv = invoice(5_004L, 2);
    tx.executeWithoutResult(s -> outbox.enqueueSale(inv));
    tx.executeWithoutResult(s -> outbox.enqueueReverse(inv, "Anulado"));
    FAKE.failNextCalls = 1;

    processor.processTenant(tenant.getId(), "c");

    List<StockOutboxEvent> list = tenantEvents();
    assertThat(list.get(0).getStatus()).isEqualTo(StockOutboxStatus.PENDING);
    assertThat(list.get(0).getAttemptCount()).isEqualTo(1);
    assertThat(list.get(0).getLastError()).contains("HTTP_503");
    assertThat(list.get(0).getNextAttemptAt()).isAfter(Instant.now().plusSeconds(30));
    assertThat(list.get(1).getStatus()).isEqualTo(StockOutboxStatus.PENDING);
    assertThat(list.get(1).getAttemptCount()).isZero();

    // Not due yet: nothing is sent.
    int callsBefore = FAKE.requests.size();
    assertThat(processor.processTenant(tenant.getId(), "c")).isZero();
    assertThat(FAKE.requests).hasSize(callsBefore);

    // Due: the reconciler wakes the tenant, both go through, sale first.
    makeDue(list.get(0).getId());
    queue.woken.clear();
    reconciler.reconcile();
    assertThat(queue.woken).contains(tenant.getId());
    processor.processTenant(tenant.getId(), "c");
    assertThat(tenantEvents()).allMatch(e -> e.getStatus() == StockOutboxStatus.DONE);
  }

  @Test
  void exhaustedRetriesFailAndBlockTheTenantUntilRetriedOrDiscarded() {
    linkTenant();
    Invoice first = invoice(5_005L, 1);
    Invoice second = invoice(5_006L, 1);
    tx.executeWithoutResult(s -> outbox.enqueueSale(first));
    tx.executeWithoutResult(s -> outbox.enqueueSale(second));
    long firstId = tenantEvents().get(0).getId();
    FAKE.failNextCalls = 100;
    // retry-delays has 2 entries → attempts 1 and 2 reschedule, attempt 3 fails for good.
    for (int i = 0; i < 3; i++) {
      makeDue(firstId);
      processor.processTenant(tenant.getId(), "c");
    }
    assertThat(events.findById(firstId).orElseThrow().getStatus())
        .isEqualTo(StockOutboxStatus.FAILED);
    assertThat(admin.summary().failed()).isPositive();

    // FAILED blocks: the second sale is never attempted, and the reconciler ignores the tenant.
    FAKE.failNextCalls = 0;
    int callsBefore = FAKE.requests.size();
    processor.processTenant(tenant.getId(), "c");
    assertThat(FAKE.requests).hasSize(callsBefore);
    assertThat(tenantEvents().get(1).getAttemptCount()).isZero();

    // Retry from the panel: back to PENDING, delivered, and the queue moves on.
    queue.woken.clear();
    StockAdminService.OutboxEventRow row = admin.retry(firstId);
    assertThat(row.status()).isEqualTo("PENDING");
    assertThat(queue.woken).contains(tenant.getId());
    processor.processTenant(tenant.getId(), "c");
    assertThat(tenantEvents()).allMatch(e -> e.getStatus() == StockOutboxStatus.DONE);
  }

  @Test
  void discardingAFailedEventUnblocksTheQueueAndCancelsItsReversal() {
    linkTenant();
    Invoice inv = invoice(5_007L, 1);
    Invoice next = invoice(5_008L, 1);
    tx.executeWithoutResult(s -> outbox.enqueueSale(inv));
    tx.executeWithoutResult(s -> outbox.enqueueSale(next));
    long saleId = tenantEvents().get(0).getId();
    StockOutboxEvent e = events.findById(saleId).orElseThrow();
    e.setStatus(StockOutboxStatus.FAILED);
    events.save(e);

    admin.discard(saleId);
    processor.processTenant(tenant.getId(), "c");

    assertThat(events.findById(saleId).orElseThrow().getStatus())
        .isEqualTo(StockOutboxStatus.DISCARDED);
    assertThat(tenantEvents().get(1).getStatus()).isEqualTo(StockOutboxStatus.DONE);
    // Nothing was sold in Stock for the discarded sale, so its void has nothing to reverse.
    tx.executeWithoutResult(s -> assertThat(outbox.enqueueReverse(inv, "Anulado")).isFalse());
  }

  @Test
  void aHeldLeaseStopsOtherWorkersAndAnExpiredOneIsRecovered() {
    linkTenant();
    tx.executeWithoutResult(s -> outbox.enqueueSale(invoice(5_009L, 1)));
    StockOutboxEvent e = tenantEvents().get(0);
    e.setStatus(StockOutboxStatus.PROCESSING);
    e.setProcessingStartedAt(Instant.now());
    e.setAttemptCount(1);
    events.save(e);

    assertThat(processor.processTenant(tenant.getId(), "c")).isZero();
    queue.woken.clear();
    reconciler.reconcile();
    assertThat(queue.woken).doesNotContain(tenant.getId());

    // The worker died: once the 5-minute lease expires the reconciler picks it up again.
    e = events.findById(e.getId()).orElseThrow();
    e.setProcessingStartedAt(Instant.now().minusSeconds(6 * 60));
    events.save(e);
    reconciler.reconcile();
    assertThat(queue.woken).contains(tenant.getId());
    processor.processTenant(tenant.getId(), "c");
    assertThat(events.findById(e.getId()).orElseThrow().getStatus())
        .isEqualTo(StockOutboxStatus.DONE);
  }

  @Test
  void tenantNotProvisionedInStockIsProvisionedBeforeRetrying() {
    StockTenantLink link = new StockTenantLink();
    link.setTenantId(tenant.getId());
    links.save(link);
    tx.executeWithoutResult(s -> outbox.enqueueSale(invoice(5_010L, 1)));

    processor.processTenant(tenant.getId(), "c");

    assertThat(tenantEvents().get(0).getStatus()).isEqualTo(StockOutboxStatus.DONE);
    assertThat(FAKE.provisionedTenants).contains(String.valueOf(tenant.getId()));
  }

  @Test
  void aRedeliveredSaleIsReplayedByStockNotMovedTwice() {
    linkTenant();
    tx.executeWithoutResult(s -> outbox.enqueueSale(invoice(5_011L, 1)));
    StockOutboxEvent sale = tenantEvents().get(0);
    processor.processTenant(tenant.getId(), "c");
    // Simulate a lost response: the same event goes out again with the same key.
    StockOutboxEvent e = events.findById(sale.getId()).orElseThrow();
    e.setStatus(StockOutboxStatus.PENDING);
    events.save(e);
    processor.processTenant(tenant.getId(), "c");

    List<FakeStockServer.Recorded> posts =
        FAKE.requests.stream()
            .filter(r -> "PELU:INVOICE:5011:0".equals(r.idempotencyKey()))
            .toList();
    assertThat(posts).hasSize(2);
    assertThat(FAKE.idempotentResponses).containsKey("PELU:INVOICE:5011:0");
  }

  @Test
  void manualCatalogSyncRequiresStockAndIsDelivered() {
    linkTenant();
    StockAdminService.TenantStockStatus status = admin.requestCatalogSync(tenant.getId());
    assertThat(status.stockEnabled()).isTrue();
    processor.processTenant(tenant.getId(), "c");
    assertThat(links.findById(tenant.getId()).orElseThrow().getCatalogSyncedAt()).isNotNull();
  }

  private void makeDue(long eventId) {
    StockOutboxEvent e = events.findById(eventId).orElseThrow();
    e.setNextAttemptAt(Instant.now().minusSeconds(1));
    events.save(e);
  }
}
