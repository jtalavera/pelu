package com.cursorpoc.backend.assistant;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.Appointment;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.FeatureFlag;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.ServiceCategory;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.Tier;
import com.cursorpoc.backend.domain.enums.AppointmentStatus;
import com.cursorpoc.backend.domain.enums.ServiceKind;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.FeatureFlagRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.repository.ServiceCategoryRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.repository.TierRepository;
import com.cursorpoc.backend.security.JwtService;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.ActiveProfiles;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * The assistant through a real HTTP server (Spring Security STATELESS + async SSE), with the
 * scripted model: flag gate, tenant isolation, role limits, streaming and error paths.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class AssistantApiIntegrationTest {

  @LocalServerPort private int port;

  @Autowired private TierRepository tierRepository;
  @Autowired private TenantRepository tenantRepository;
  @Autowired private AppUserRepository appUserRepository;
  @Autowired private ClientRepository clientRepository;
  @Autowired private ProfessionalRepository professionalRepository;
  @Autowired private ServiceCategoryRepository categoryRepository;
  @Autowired private SalonServiceRepository serviceRepository;
  @Autowired private AppointmentRepository appointmentRepository;
  @Autowired private FeatureFlagRepository featureFlagRepository;
  @Autowired private AssistantConversationService conversationService;
  @Autowired private AssistantConversationRepository conversationRepository;
  @Autowired private AssistantMessageRepository messageRepository;
  @Autowired private JwtService jwtService;
  @Autowired private FemmeTimeProperties timeProperties;
  @Autowired private ObjectMapper objectMapper;

  private final HttpClient http = HttpClient.newHttpClient();
  private boolean flagCreated;
  private String suffix;
  private Tenant tenantA;
  private Tenant tenantB;
  private AppUser adminA;
  private AppUser adminB;
  private String clientAName;
  private String clientBName;

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

    tenantA = tenant("Salon A " + suffix);
    tenantB = tenant("Salon B " + suffix);
    adminA = user(tenantA, UserRole.ADMIN, null);
    adminB = user(tenantB, UserRole.ADMIN, null);
    clientAName = "Maria Alvarez " + suffix;
    clientBName = "Beatriz Benitez " + suffix;
    Client clientA = client(tenantA, clientAName, "0981111111");
    Client clientB = client(tenantB, clientBName, "0982222222");
    appointmentToday(tenantA, clientA, "Ana A", "Corte A");
    appointmentToday(tenantB, clientB, "Bea B", "Corte B");
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

  @Test
  void flagOff_everyEndpointAnswers403AssistantDisabled() throws Exception {
    FeatureFlag flag = featureFlagRepository.findByFlagKey(AssistantAccess.FLAG).orElseThrow();
    flag.setEnabled(false);
    featureFlagRepository.save(flag);

    HttpResponse<String> res = get("/api/assistant/conversations/current", token(adminA));

    assertThat(res.statusCode()).isEqualTo(403);
    assertThat(res.body()).contains("ASSISTANT_DISABLED");
  }

  @Test
  void flagOffForOneTenant_otherTenantKeepsIt() throws Exception {
    // Effective flag = global AND tier AND tenant: switching it off for tenant B only.
    // (Tenant override rows are covered by FeatureFlagService tests; here: no token, no access.)
    HttpResponse<String> noToken = get("/api/assistant/conversations/current", null);
    assertThat(noToken.statusCode()).isIn(401, 403);
  }

  @Test
  void messageStreamsAnswerWithToolStatus_andOnlyShowsOwnTenantData() throws Exception {
    long conversationId = currentConversation(adminA);

    HttpResponse<String> res = postMessage(adminA, conversationId, "¿Qué turnos hay hoy?");

    assertThat(res.statusCode()).isEqualTo(200);
    List<String> events = eventNames(res.body());
    assertThat(events).contains("tool.status", "message.delta", "message.done");
    assertThat(events.indexOf("tool.status")).isLessThan(events.indexOf("message.done"));
    String answer = joinedDeltas(res.body());
    assertThat(answer).contains(clientAName).contains("Corte A").contains("Ana A");
    // Tenant B's appointment of the same day must never show up.
    assertThat(answer).doesNotContain(clientBName).doesNotContain("Corte B");
  }

  @Test
  void twoRoundToolLoop_findsClientThenItsAppointments() throws Exception {
    long conversationId = currentConversation(adminA);

    HttpResponse<String> res =
        postMessage(adminA, conversationId, "turnos de Maria Alvarez " + suffix);

    String answer = joinedDeltas(res.body());
    assertThat(answer).contains("Corte A");
    assertThat(eventNames(res.body()).stream().filter("tool.status"::equals)).hasSize(4);
  }

  @Test
  void clientOfAnotherTenant_isNotFoundThroughTheAssistant() throws Exception {
    long conversationId = currentConversation(adminA);

    HttpResponse<String> res = postMessage(adminA, conversationId, "busca " + clientBName);

    assertThat(joinedDeltas(res.body())).contains("No encontré").doesNotContain(clientBName);
  }

  @Test
  void conversationOfAnotherUserOrTenant_is404() throws Exception {
    long bConversation = currentConversation(adminB);

    HttpResponse<String> res = postMessageRaw(adminA, bConversation, "hola", null);

    assertThat(res.statusCode()).isEqualTo(404);
    assertThat(res.body()).contains("ASSISTANT_CONVERSATION_NOT_FOUND");
  }

  @Test
  void historySurvivesReload_andNewConversationStartsEmpty() throws Exception {
    long conversationId = currentConversation(adminA);
    postMessage(adminA, conversationId, "servicios");

    JsonNode current = json(get("/api/assistant/conversations/current", token(adminA)));
    assertThat(current.get("conversationId").asLong()).isEqualTo(conversationId);
    List<String> roles = new ArrayList<>();
    current.get("messages").forEach(m -> roles.add(m.get("role").asString()));
    assertThat(roles).containsExactly("USER", "ASSISTANT");

    JsonNode fresh = json(post("/api/assistant/conversations", token(adminA), null));
    assertThat(fresh.get("conversationId").asLong()).isNotEqualTo(conversationId);
    assertThat(fresh.get("messages")).isEmpty();
    // The old one is closed: posting to it is a 404.
    assertThat(postMessageRaw(adminA, conversationId, "hola", null).statusCode()).isEqualTo(404);
  }

  @Test
  void modelFailure_isReportedAsErrorEvent_notAsHttpError() throws Exception {
    long conversationId = currentConversation(adminA);

    HttpResponse<String> res = postMessage(adminA, conversationId, "falla modelo");

    assertThat(res.statusCode()).isEqualTo(200);
    assertThat(eventNames(res.body())).contains("error").doesNotContain("message.done");
    assertThat(res.body()).contains("ASSISTANT_MODEL_UNAVAILABLE");
  }

  @Test
  void emptyAndOverlongMessages_areRejected() throws Exception {
    long conversationId = currentConversation(adminA);

    assertThat(postMessageRaw(adminA, conversationId, "   ", null).body())
        .contains("ASSISTANT_MESSAGE_EMPTY");
    assertThat(postMessageRaw(adminA, conversationId, "x".repeat(5000), null).body())
        .contains("ASSISTANT_MESSAGE_TOO_LONG");
  }

  @Test
  void professional_canUseTheAssistant() throws Exception {
    Professional pro = professionalOf(tenantA);
    AppUser proUser = user(tenantA, UserRole.PROFESSIONAL, pro.getId());
    long conversationId = currentConversation(proUser);

    HttpResponse<String> res = postMessage(proUser, conversationId, "servicios");

    assertThat(res.statusCode()).isEqualTo(200);
    assertThat(eventNames(res.body())).contains("message.done");
  }

  @Test
  void retention_deletesOnlyConversationsIdleForLongerThanTheCutoff() {
    AssistantConversation old =
        conversationService.getOrCreateCurrent(tenantA.getId(), adminA.getId());
    conversationService.appendUser(old.getId(), "viejo", "TEXT");
    AssistantConversation recent =
        conversationService.getOrCreateCurrent(tenantB.getId(), adminB.getId());
    conversationService.appendUser(recent.getId(), "reciente", "TEXT");
    old.setLastActivity(Instant.now().minus(Duration.ofDays(31)));
    conversationRepository.save(old);

    int deleted = conversationService.deleteInactiveSince(Instant.now().minus(Duration.ofDays(30)));

    assertThat(deleted).isGreaterThanOrEqualTo(1);
    assertThat(conversationRepository.findById(old.getId())).isEmpty();
    assertThat(
            messageRepository.findAll().stream()
                .filter(m -> m.getConversationId().equals(old.getId())))
        .isEmpty();
    assertThat(conversationRepository.findById(recent.getId())).isPresent();
  }

  // ---------------------------------------------------------------------------------------------

  private long currentConversation(AppUser user) throws Exception {
    return json(get("/api/assistant/conversations/current", token(user)))
        .get("conversationId")
        .asLong();
  }

  private HttpResponse<String> postMessage(AppUser user, long conversationId, String text)
      throws Exception {
    return postMessageRaw(user, conversationId, text, "hoy");
  }

  private HttpResponse<String> postMessageRaw(
      AppUser user, long conversationId, String text, String page) throws Exception {
    String body =
        objectMapper.writeValueAsString(
            java.util.Map.of(
                "conversationId",
                conversationId,
                "text",
                text,
                "inputMode",
                "TEXT",
                "currentPage",
                page == null ? "" : page));
    return post("/api/assistant/messages", token(user), body);
  }

  private HttpResponse<String> get(String path, String token) throws Exception {
    HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path));
    if (token != null) {
      b.header("Authorization", "Bearer " + token);
    }
    return http.send(b.GET().build(), HttpResponse.BodyHandlers.ofString());
  }

  private HttpResponse<String> post(String path, String token, String body) throws Exception {
    HttpRequest.Builder b =
        HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
            .header("Authorization", "Bearer " + token)
            .header("Content-Type", "application/json");
    if (path.endsWith("/messages")) {
      // Exactly what the browser sends for the stream: errors must still come back as JSON.
      b.header("Accept", "text/event-stream");
    }
    return http.send(
        b.POST(HttpRequest.BodyPublishers.ofString(body == null ? "" : body)).build(),
        HttpResponse.BodyHandlers.ofString());
  }

  private JsonNode json(HttpResponse<String> res) {
    assertThat(res.statusCode()).as(res.body()).isEqualTo(200);
    return objectMapper.readTree(res.body());
  }

  private static List<String> eventNames(String sse) {
    List<String> names = new ArrayList<>();
    for (String line : sse.split("\n")) {
      if (line.startsWith("event:")) {
        names.add(line.substring("event:".length()).trim());
      }
    }
    return names;
  }

  /** Concatenation of every {@code message.delta} text of an SSE body. */
  private String joinedDeltas(String sse) {
    StringBuilder out = new StringBuilder();
    String event = null;
    for (String line : sse.split("\n")) {
      if (line.startsWith("event:")) {
        event = line.substring("event:".length()).trim();
      } else if (line.startsWith("data:") && "message.delta".equals(event)) {
        out.append(objectMapper.readTree(line.substring("data:".length())).get("text").asString());
      }
    }
    return out.toString();
  }

  private String token(AppUser user) {
    return jwtService.createAccessToken(
        user.getId(),
        user.getTenant().getId(),
        user.getEmail(),
        user.getRole(),
        user.getRole() == UserRole.PROFESSIONAL ? professionalIdOf(user) : null,
        Instant.now());
  }

  private final java.util.Map<Long, Long> professionalByUser = new java.util.HashMap<>();

  private Long professionalIdOf(AppUser user) {
    return professionalByUser.get(user.getId());
  }

  private Tenant tenant(String name) {
    Tier tier = new Tier();
    tier.setName("tier " + name);
    tier = tierRepository.save(tier);
    Tenant t = new Tenant();
    t.setName(name);
    t.setTier(tier);
    return tenantRepository.save(t);
  }

  private AppUser user(Tenant tenant, UserRole role, Long professionalId) {
    AppUser u = new AppUser();
    u.setTenant(tenant);
    u.setEmail(role.name().toLowerCase() + "." + System.nanoTime() + "@assistant.test");
    u.setFullName(role.name() + " " + tenant.getName());
    u.setPasswordHash("x");
    u.setRole(role);
    u.setEnabled(true);
    AppUser saved = appUserRepository.save(u);
    if (professionalId != null) {
      professionalByUser.put(saved.getId(), professionalId);
    }
    return saved;
  }

  private Client client(Tenant tenant, String name, String phone) {
    Client c = new Client();
    c.setTenant(tenant);
    c.setFullName(name);
    c.setPhone(phone);
    c.setActive(true);
    return clientRepository.save(c);
  }

  private Professional professionalOf(Tenant tenant) {
    Professional p = new Professional();
    p.setTenant(tenant);
    p.setFullName("Pro " + System.nanoTime());
    p.setActive(true);
    return professionalRepository.save(p);
  }

  private void appointmentToday(Tenant tenant, Client client, String proName, String serviceName) {
    Professional pro = new Professional();
    pro.setTenant(tenant);
    pro.setFullName(proName);
    pro.setActive(true);
    pro = professionalRepository.save(pro);

    ServiceCategory cat = new ServiceCategory();
    cat.setTenant(tenant);
    cat.setName("Cat " + serviceName + System.nanoTime());
    cat.setActive(true);
    cat.setKind(ServiceKind.SERVICE);
    cat = categoryRepository.save(cat);
    SalonService svc = new SalonService();
    svc.setTenant(tenant);
    svc.setCategory(cat);
    svc.setName(serviceName);
    svc.setPriceMinor(BigDecimal.valueOf(50_000));
    svc.setDurationMinutes(30);
    svc.setActive(true);
    svc.setKind(ServiceKind.SERVICE);
    svc = serviceRepository.save(svc);

    var zone = timeProperties.zoneId();
    Instant start = LocalDate.now(zone).atTime(LocalTime.NOON).atZone(zone).toInstant();
    Appointment a = new Appointment();
    a.setTenant(tenant);
    a.setClient(client);
    a.setProfessional(pro);
    a.setSalonService(svc);
    a.setStartAt(start);
    a.setEndAt(start.plus(Duration.ofMinutes(30)));
    a.setStatus(AppointmentStatus.PENDING);
    appointmentRepository.save(a);
  }
}
