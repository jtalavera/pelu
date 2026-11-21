package com.cursorpoc.backend.assistant;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.AuditLog;
import com.cursorpoc.backend.domain.CashSession;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.FeatureFlag;
import com.cursorpoc.backend.domain.FiscalStamp;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.ServiceCategory;
import com.cursorpoc.backend.domain.Tax;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.Tier;
import com.cursorpoc.backend.domain.enums.ServiceKind;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.AuditLogRepository;
import com.cursorpoc.backend.repository.CashSessionRepository;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.FeatureFlagRepository;
import com.cursorpoc.backend.repository.FiscalStampRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.repository.ServiceCategoryRepository;
import com.cursorpoc.backend.repository.TaxRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.repository.TierRepository;
import com.cursorpoc.backend.security.JwtService;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Invoice drafts end to end through a real server (scripted model): the model only PROPOSES; the
 * invoice exists only after the person's confirm call, once, through the regular invoicing road.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class AssistantDraftIntegrationTest {

  @LocalServerPort private int port;

  @Autowired private TierRepository tierRepository;
  @Autowired private TenantRepository tenantRepository;
  @Autowired private AppUserRepository appUserRepository;
  @Autowired private ClientRepository clientRepository;
  @Autowired private ProfessionalRepository professionalRepository;
  @Autowired private ServiceCategoryRepository categoryRepository;
  @Autowired private SalonServiceRepository serviceRepository;
  @Autowired private TaxRepository taxRepository;
  @Autowired private FiscalStampRepository fiscalStampRepository;
  @Autowired private CashSessionRepository cashSessionRepository;
  @Autowired private InvoiceRepository invoiceRepository;
  @Autowired private AuditLogRepository auditLogRepository;
  @Autowired private FeatureFlagRepository featureFlagRepository;
  @Autowired private AssistantDraftRepository draftRepository;
  @Autowired private AssistantDraftService draftService;
  @Autowired private JwtService jwtService;
  @Autowired private JdbcTemplate jdbc;
  @Autowired private ObjectMapper objectMapper;

  private final HttpClient http = HttpClient.newHttpClient();
  private boolean flagCreated;
  private String suffix;
  private Tenant tenant;
  private AppUser admin;
  private String clientName;
  private String serviceName;
  private SalonService service;
  private CashSession cashSession;

  @BeforeEach
  void setUp() {
    suffix = Long.toString(System.nanoTime());
    FeatureFlag flag = featureFlagRepository.findByFlagKey(AssistantAccess.FLAG).orElse(null);
    if (flag == null) {
      flag = new FeatureFlag();
      flag.setFlagKey(AssistantAccess.FLAG);
      flag.setDescription("test");
      flagCreated = true;
    }
    flag.setEnabled(true);
    featureFlagRepository.save(flag);

    Tier tier = new Tier();
    tier.setName("tier " + suffix);
    tier = tierRepository.save(tier);
    tenant = new Tenant();
    tenant.setName("Salon " + suffix);
    tenant.setTier(tier);
    tenant = tenantRepository.save(tenant);
    admin = user(tenant, UserRole.ADMIN);

    Tax iva = new Tax();
    iva.setTenant(tenant);
    iva.setName("IVA 10");
    iva.setRate(BigDecimal.TEN);
    iva.setActive(true);
    iva = taxRepository.save(iva);
    ServiceCategory category = new ServiceCategory();
    category.setTenant(tenant);
    category.setName("Cabello " + suffix);
    category.setActive(true);
    category.setKind(ServiceKind.SERVICE);
    category = categoryRepository.save(category);
    serviceName = "Corte " + suffix;
    service = new SalonService();
    service.setTenant(tenant);
    service.setCategory(category);
    service.setName(serviceName);
    service.setPriceMinor(BigDecimal.valueOf(110_000));
    service.setDurationMinutes(30);
    service.setActive(true);
    service.setKind(ServiceKind.SERVICE);
    service.setTax(iva);
    service = serviceRepository.save(service);

    clientName = "Maria Alvarez " + suffix;
    Client client = new Client();
    client.setTenant(tenant);
    client.setFullName(clientName);
    client.setActive(true);
    clientRepository.save(client);

    FiscalStamp stamp = new FiscalStamp();
    stamp.setTenant(tenant);
    stamp.setStampNumber("ST-" + suffix);
    stamp.setValidFrom(LocalDate.of(2026, 1, 1));
    stamp.setRangeFrom(1);
    stamp.setNextEmissionNumber(1);
    stamp.setActive(true);
    fiscalStampRepository.save(stamp);
    cashSession = openCash();
  }

  @AfterEach
  void tearDown() {
    FeatureFlag flag = featureFlagRepository.findByFlagKey(AssistantAccess.FLAG).orElse(null);
    if (flag != null) {
      if (flagCreated) {
        featureFlagRepository.delete(flag);
      } else {
        flag.setEnabled(false);
        featureFlagRepository.save(flag);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------

  @Test
  void proposeCompleteConfirm_issuesTheInvoiceOnce_andARepeatedConfirmIs409WithTheOriginalResult()
      throws Exception {
    long conv = currentConversation(admin);
    JsonNode draft = proposeInvoice(admin, conv);

    assertThat(draft.get("status").asString()).isEqualTo("DRAFT");
    assertThat(draft.get("missing"))
        .extracting(JsonNode::asString)
        .containsExactly("PAYMENT_METHOD");
    assertThat(draft.get("payload").get("total").asLong()).isEqualTo(110_000);
    // Proposing wrote nothing: no invoice yet.
    assertThat(invoiceCount()).isZero();

    String id = draft.get("id").asString();
    // Incomplete: the button would not work yet.
    HttpResponse<String> incomplete =
        post("/api/assistant/drafts/" + id + "/confirm", admin, null, id);
    assertThat(incomplete.statusCode()).isEqualTo(400);
    assertThat(incomplete.body()).contains("ASSISTANT_DRAFT_INCOMPLETE");
    assertThat(invoiceCount()).isZero();

    // The card completes what is missing.
    HttpResponse<String> patched =
        patch("/api/assistant/drafts/" + id, admin, "{\"paymentMethod\":\"CASH\"}");
    assertThat(patched.statusCode()).as(patched.body()).isEqualTo(200);
    assertThat(json(patched).get("missing")).isEmpty();

    HttpResponse<String> confirmed =
        post("/api/assistant/drafts/" + id + "/confirm", admin, null, id);
    assertThat(confirmed.statusCode()).as(confirmed.body()).isEqualTo(200);
    JsonNode result = json(confirmed);
    assertThat(result.get("type").asString()).isEqualTo("INVOICE");
    long invoiceId = result.get("invoiceId").asLong();
    assertThat(invoiceCount()).isEqualTo(1);
    assertThat(invoiceRepository.findById(invoiceId).orElseThrow().getTotal())
        .isEqualByComparingTo("110000");
    assertThat(result.get("draft").get("status").asString()).isEqualTo("CONFIRMED");

    // A second tap: nothing issued twice, the answer carries the original result.
    HttpResponse<String> again = post("/api/assistant/drafts/" + id + "/confirm", admin, null, id);
    assertThat(again.statusCode()).isEqualTo(409);
    JsonNode body = json(again);
    assertThat(body.get("error").asString()).isEqualTo("ASSISTANT_DRAFT_ALREADY_CONFIRMED");
    assertThat(body.get("invoiceId").asLong()).isEqualTo(invoiceId);
    assertThat(invoiceCount()).isEqualTo(1);

    // The audit trail has ONE business row for it, with its origin.
    List<AuditLog> rows =
        auditLogRepository.findAll().stream()
            .filter(r -> "ASSISTANT".equals(r.getSource()))
            .filter(r -> tenant.getId().equals(r.getTenantId()))
            .toList();
    assertThat(rows).hasSize(1);
    assertThat(rows.get(0).getResource()).isEqualTo("invoices");
    assertThat(rows.get(0).getOperation()).isEqualTo("issue");
    assertThat(rows.get(0).getEntityId()).isEqualTo(String.valueOf(invoiceId));
  }

  @Test
  void twoSimultaneousConfirms_issueExactlyOneInvoice() throws Exception {
    long conv = currentConversation(admin);
    String id = proposeInvoice(admin, conv).get("id").asString();
    assertThat(
            patch("/api/assistant/drafts/" + id, admin, "{\"paymentMethod\":\"CASH\"}")
                .statusCode())
        .isEqualTo(200);

    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      List<Callable<HttpResponse<String>>> taps = new ArrayList<>();
      for (int i = 0; i < 2; i++) {
        taps.add(() -> post("/api/assistant/drafts/" + id + "/confirm", admin, null, id));
      }
      List<Integer> statuses = new ArrayList<>();
      for (Future<HttpResponse<String>> f : pool.invokeAll(taps)) {
        statuses.add(f.get().statusCode());
      }
      assertThat(statuses).containsExactlyInAnyOrder(200, 409);
    } finally {
      pool.shutdownNow();
    }
    assertThat(invoiceCount()).isEqualTo(1);
  }

  @Test
  void aPriceThatChangedSinceTheProposal_isNotIssued_theDraftComesBackRecalculated()
      throws Exception {
    long conv = currentConversation(admin);
    String id = proposeInvoice(admin, conv).get("id").asString();
    patch("/api/assistant/drafts/" + id, admin, "{\"paymentMethod\":\"CASH\"}");
    service.setPriceMinor(BigDecimal.valueOf(130_000));
    serviceRepository.save(service);

    HttpResponse<String> res = post("/api/assistant/drafts/" + id + "/confirm", admin, null, id);

    assertThat(res.statusCode()).isEqualTo(409);
    JsonNode body = json(res);
    assertThat(body.get("error").asString()).isEqualTo("ASSISTANT_PRICE_CHANGED");
    assertThat(body.get("draft").get("payload").get("total").asLong()).isEqualTo(130_000);
    assertThat(body.get("draft").get("status").asString()).isEqualTo("DRAFT");
    assertThat(invoiceCount()).isZero();

    // The person reviewed the new price and confirms again: now it is issued at the new price.
    HttpResponse<String> ok = post("/api/assistant/drafts/" + id + "/confirm", admin, null, id);
    assertThat(ok.statusCode()).as(ok.body()).isEqualTo(200);
    assertThat(
            invoiceRepository.findById(json(ok).get("invoiceId").asLong()).orElseThrow().getTotal())
        .isEqualByComparingTo("130000");
  }

  @Test
  void whenIssuingFails_everythingRollsBack_andTheDraftIsStillADraft() throws Exception {
    long conv = currentConversation(admin);
    String id = proposeInvoice(admin, conv).get("id").asString();
    patch("/api/assistant/drafts/" + id, admin, "{\"paymentMethod\":\"CASH\"}");
    cashSessionRepository.delete(cashSession); // no open cash register

    HttpResponse<String> res = post("/api/assistant/drafts/" + id + "/confirm", admin, null, id);

    assertThat(res.statusCode()).isEqualTo(409);
    assertThat(res.body()).contains("CASH_SESSION_NOT_OPEN");
    assertThat(invoiceCount()).isZero();
    assertThat(draftRepository.findById(java.util.UUID.fromString(id)).orElseThrow().getStatus())
        .isEqualTo(AssistantDraftStatus.DRAFT);

    openCash();
    assertThat(post("/api/assistant/drafts/" + id + "/confirm", admin, null, id).statusCode())
        .isEqualTo(200);
    assertThat(invoiceCount()).isEqualTo(1);
  }

  @Test
  void aNewProposalSupersedesThePreviousOne_andTheOldCardCanNoLongerBeConfirmed() throws Exception {
    long conv = currentConversation(admin);
    String first = proposeInvoice(admin, conv).get("id").asString();
    AssistantAnswerBody second = ask(admin, conv, "invoice " + clientName + " for " + serviceName);

    JsonNode update =
        second.events.stream()
            .filter(e -> e.event.equals("card.draft.updated"))
            .findFirst()
            .orElseThrow()
            .data;
    assertThat(update.get("id").asString()).isEqualTo(first);
    assertThat(update.get("status").asString()).isEqualTo("SUPERSEDED");
    HttpResponse<String> res =
        post("/api/assistant/drafts/" + first + "/confirm", admin, null, first);
    assertThat(res.statusCode()).isEqualTo(409);
    assertThat(res.body()).contains("ASSISTANT_DRAFT_NOT_ACTIVE");
  }

  @Test
  void discardingFromTheCard_orFromTheChat_leavesNothingToConfirm() throws Exception {
    long conv = currentConversation(admin);
    String id = proposeInvoice(admin, conv).get("id").asString();
    assertThat(post("/api/assistant/drafts/" + id + "/discard", admin, null, null).statusCode())
        .isEqualTo(200);
    assertThat(post("/api/assistant/drafts/" + id + "/confirm", admin, null, id).statusCode())
        .isEqualTo(409);

    String second = proposeInvoice(admin, conv).get("id").asString();
    AssistantAnswerBody chat = ask(admin, conv, "discard the draft");
    assertThat(chat.events.stream().map(e -> e.event + ":" + e.data.path("status").asString("")))
        .contains("card.draft.updated:DISCARDED");
    assertThat(
            post("/api/assistant/drafts/" + second + "/confirm", admin, null, second).statusCode())
        .isEqualTo(409);
    assertThat(invoiceCount()).isZero();
  }

  @Test
  void aDraftNobodyConfirmedIn24Hours_isExpired() throws Exception {
    long conv = currentConversation(admin);
    String id = proposeInvoice(admin, conv).get("id").asString();
    jdbc.update(
        "UPDATE assistant_draft SET expires_at = ? WHERE id = ?",
        java.sql.Timestamp.from(Instant.now().minusSeconds(60)),
        java.util.UUID.fromString(id));

    HttpResponse<String> res = post("/api/assistant/drafts/" + id + "/confirm", admin, null, id);
    assertThat(res.statusCode()).isEqualTo(409);
    assertThat(res.body()).contains("ASSISTANT_DRAFT_EXPIRED");

    assertThat(draftService.expireDue()).isGreaterThanOrEqualTo(1);
    assertThat(draftRepository.findById(java.util.UUID.fromString(id)).orElseThrow().getStatus())
        .isEqualTo(AssistantDraftStatus.EXPIRED);
    assertThat(invoiceCount()).isZero();
  }

  @Test
  void aDraftBelongsToItsOwnerAndOnlyAdministratorsConfirm() throws Exception {
    long conv = currentConversation(admin);
    String id = proposeInvoice(admin, conv).get("id").asString();

    AppUser otherAdmin = user(tenant, UserRole.ADMIN);
    assertThat(post("/api/assistant/drafts/" + id + "/confirm", otherAdmin, null, id).statusCode())
        .isEqualTo(404);
    assertThat(
            patch("/api/assistant/drafts/" + id, otherAdmin, "{\"paymentMethod\":\"CASH\"}")
                .statusCode())
        .isEqualTo(404);

    AppUser pro = user(tenant, UserRole.PROFESSIONAL);
    assertThat(post("/api/assistant/drafts/" + id + "/confirm", pro, null, id).statusCode())
        .isEqualTo(403);
    // An id that is not even a UUID is a clean 400, not a stack trace.
    assertThat(post("/api/assistant/drafts/no-es-un-uuid/confirm", admin, null, null).statusCode())
        .isEqualTo(400);
    assertThat(invoiceCount()).isZero();
  }

  @Test
  void aProfessionalIsNeverOfferedToInvoice() throws Exception {
    AppUser pro = user(tenant, UserRole.PROFESSIONAL);
    long conv = currentConversation(pro);

    AssistantAnswerBody res = ask(pro, conv, "invoice " + clientName + " for " + serviceName);

    // The tool is not even offered: the scripted model asks for it and the backend refuses.
    assertThat(res.events.stream().map(e -> e.event)).doesNotContain("card.draft");
    assertThat(draftRepository.findAll().stream().filter(d -> d.getUserId().equals(pro.getId())))
        .isEmpty();
  }

  @Test
  void reloadingTheConversation_returnsTheDraftsWithTheirMessage() throws Exception {
    long conv = currentConversation(admin);
    String id = proposeInvoice(admin, conv).get("id").asString();

    JsonNode view = json(get("/api/assistant/conversations/current", admin));

    JsonNode drafts = view.get("drafts");
    assertThat(drafts).hasSize(1);
    assertThat(drafts.get(0).get("id").asString()).isEqualTo(id);
    assertThat(drafts.get(0).get("messageId").asLong()).isPositive();
  }

  @Test
  void aClientWithNothingToInvoice_getsNoDraft() throws Exception {
    long conv = currentConversation(admin);

    AssistantAnswerBody res = ask(admin, conv, "invoice " + clientName);

    assertThat(res.events.stream().map(e -> e.event)).doesNotContain("card.draft");
    assertThat(res.text).contains("No encontré nada para facturar");
    assertThat(
            draftRepository.findAll().stream().filter(d -> d.getTenantId().equals(tenant.getId())))
        .isEmpty();
  }

  // ---------------------------------------------------------------------------------------------

  private JsonNode proposeInvoice(AppUser user, long conversationId) throws Exception {
    AssistantAnswerBody res =
        ask(user, conversationId, "invoice " + clientName + " for " + serviceName);
    return res.events.stream()
        .filter(e -> e.event.equals("card.draft"))
        .findFirst()
        .orElseThrow(() -> new AssertionError("no card.draft in: " + res.raw))
        .data;
  }

  private record Event(String event, JsonNode data) {}

  private static final class AssistantAnswerBody {
    String raw;
    List<Event> events = new ArrayList<>();
    String text = "";
  }

  private AssistantAnswerBody ask(AppUser user, long conversationId, String text) throws Exception {
    HttpResponse<String> res =
        post(
            "/api/assistant/messages",
            user,
            objectMapper.writeValueAsString(
                Map.of("conversationId", conversationId, "text", text, "inputMode", "TEXT")),
            null);
    assertThat(res.statusCode()).as(res.body()).isEqualTo(200);
    AssistantAnswerBody out = new AssistantAnswerBody();
    out.raw = res.body();
    for (String block : res.body().split("\n\n")) {
      String name = null;
      StringBuilder data = new StringBuilder();
      for (String line : block.trim().split("\n")) {
        if (line.startsWith("event:")) name = line.substring(6).trim();
        if (line.startsWith("data:")) data.append(line.substring(5));
      }
      if (name != null) {
        JsonNode node = objectMapper.readTree(data.toString());
        out.events.add(new Event(name, node));
        if (name.equals("message.delta")) out.text += node.get("text").asString();
      }
    }
    return out;
  }

  private long currentConversation(AppUser user) throws Exception {
    return json(get("/api/assistant/conversations/current", user)).get("conversationId").asLong();
  }

  private long invoiceCount() {
    return invoiceRepository.findAll().stream()
        .filter(i -> i.getTenant().getId().equals(tenant.getId()))
        .count();
  }

  private CashSession openCash() {
    CashSession session = new CashSession();
    session.setTenant(tenant);
    session.setOpenedByUser(admin);
    session.setOpenedAt(Instant.now());
    session.setOpeningCashAmount(BigDecimal.ZERO);
    return cashSessionRepository.save(session);
  }

  private AppUser user(Tenant t, UserRole role) {
    AppUser u = new AppUser();
    u.setTenant(t);
    u.setEmail(role.name().toLowerCase() + "." + System.nanoTime() + "@draft.test");
    u.setFullName(role.name());
    u.setPasswordHash("x");
    u.setRole(role);
    u.setEnabled(true);
    AppUser saved = appUserRepository.save(u);
    if (role == UserRole.PROFESSIONAL) {
      Professional p = new Professional();
      p.setTenant(t);
      p.setFullName("Pro " + System.nanoTime());
      p.setActive(true);
      professionalIds.put(saved.getId(), professionalRepository.save(p).getId());
    }
    return saved;
  }

  private final Map<Long, Long> professionalIds = new java.util.HashMap<>();

  private String token(AppUser user) {
    return jwtService.createAccessToken(
        user.getId(),
        user.getTenant().getId(),
        user.getEmail(),
        user.getRole(),
        professionalIds.get(user.getId()),
        Instant.now());
  }

  private HttpResponse<String> get(String path, AppUser user) throws Exception {
    return http.send(
        HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
            .header("Authorization", "Bearer " + token(user))
            .GET()
            .build(),
        HttpResponse.BodyHandlers.ofString());
  }

  private HttpResponse<String> post(String path, AppUser user, String body, String idempotencyKey)
      throws Exception {
    HttpRequest.Builder b =
        HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
            .header("Authorization", "Bearer " + token(user))
            .header("Content-Type", "application/json");
    if (path.endsWith("/messages")) {
      b.header("Accept", "text/event-stream");
    }
    if (idempotencyKey != null) {
      b.header("Idempotency-Key", idempotencyKey);
    }
    return http.send(
        b.POST(HttpRequest.BodyPublishers.ofString(body == null ? "" : body)).build(),
        HttpResponse.BodyHandlers.ofString());
  }

  private HttpResponse<String> patch(String path, AppUser user, String body) throws Exception {
    return http.send(
        HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
            .header("Authorization", "Bearer " + token(user))
            .header("Content-Type", "application/json")
            .method("PATCH", HttpRequest.BodyPublishers.ofString(body))
            .build(),
        HttpResponse.BodyHandlers.ofString());
  }

  private JsonNode json(HttpResponse<String> res) {
    return objectMapper.readTree(res.body());
  }
}
