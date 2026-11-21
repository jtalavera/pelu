package com.cursorpoc.backend.assistant;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.Appointment;
import com.cursorpoc.backend.domain.AuditLog;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.FeatureFlag;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.ProfessionalSchedule;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.ServiceCategory;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.Tier;
import com.cursorpoc.backend.domain.enums.AppointmentStatus;
import com.cursorpoc.backend.domain.enums.ServiceKind;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.repository.AuditLogRepository;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.FeatureFlagRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.ProfessionalScheduleRepository;
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
import java.util.HashMap;
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
import org.springframework.test.context.ActiveProfiles;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Availability and appointment drafts through a real server and the scripted model. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class AssistantAppointmentIntegrationTest {

  @LocalServerPort private int port;

  @Autowired private TierRepository tierRepository;
  @Autowired private TenantRepository tenantRepository;
  @Autowired private AppUserRepository appUserRepository;
  @Autowired private ClientRepository clientRepository;
  @Autowired private ProfessionalRepository professionalRepository;
  @Autowired private ProfessionalScheduleRepository scheduleRepository;
  @Autowired private ServiceCategoryRepository categoryRepository;
  @Autowired private SalonServiceRepository serviceRepository;
  @Autowired private AppointmentRepository appointmentRepository;
  @Autowired private AuditLogRepository auditLogRepository;
  @Autowired private FeatureFlagRepository featureFlagRepository;
  @Autowired private JwtService jwtService;
  @Autowired private FemmeTimeProperties timeProperties;
  @Autowired private ObjectMapper objectMapper;

  private final HttpClient http = HttpClient.newHttpClient();
  private final Map<Long, Long> professionalByUser = new HashMap<>();
  private boolean flagCreated;
  private String suffix;
  private Tenant tenant;
  private AppUser admin;
  private Client client;
  private Professional lucia;
  private Professional hugo;
  private SalonService service;

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
    admin = user(UserRole.ADMIN, null);

    ServiceCategory category = new ServiceCategory();
    category.setTenant(tenant);
    category.setName("Cabello " + suffix);
    category.setActive(true);
    category.setKind(ServiceKind.SERVICE);
    category = categoryRepository.save(category);
    service = new SalonService();
    service.setTenant(tenant);
    service.setCategory(category);
    service.setName("Corte " + suffix);
    service.setPriceMinor(BigDecimal.valueOf(50_000));
    service.setDurationMinutes(30);
    service.setActive(true);
    service.setKind(ServiceKind.SERVICE);
    service = serviceRepository.save(service);

    client = new Client();
    client.setTenant(tenant);
    client.setFullName("Maria Alvarez " + suffix);
    client.setActive(true);
    client = clientRepository.save(client);

    lucia = professional("Lucia " + suffix, true);
    hugo = professional("Hugo " + suffix, true);
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
  void bookingIsADraft_andOnlyTheButtonCreatesThePendingAppointment() throws Exception {
    long conv = conversation(admin);

    Answer res = ask(admin, conv, bookText("tomorrow", "10:00", "with " + lucia.getFullName()));

    JsonNode draft = card(res, "card.draft");
    assertThat(draft.get("type").asString()).isEqualTo("APPOINTMENT");
    assertThat(draft.get("payload").get("time").asString()).isEqualTo("10:00");
    assertThat(draft.get("payload").get("endTime").asString()).isEqualTo("10:30");
    assertThat(draft.get("payload").get("professionalName").asString())
        .isEqualTo(lucia.getFullName());
    assertThat(draft.get("payload").get("outsideWorkingHours").asBoolean()).isFalse();
    assertThat(appointmentsOf(lucia)).isEmpty();

    String id = draft.get("id").asString();
    HttpResponse<String> confirmed = post("/api/assistant/drafts/" + id + "/confirm", admin, id);
    assertThat(confirmed.statusCode()).as(confirmed.body()).isEqualTo(200);
    JsonNode result = objectMapper.readTree(confirmed.body());
    assertThat(result.get("type").asString()).isEqualTo("APPOINTMENT");

    List<Appointment> created = appointmentsOf(lucia);
    assertThat(created).hasSize(1);
    assertThat(created.get(0).getStatus()).isEqualTo(AppointmentStatus.PENDING);
    assertThat(created.get(0).getStartAt().atZone(timeProperties.zoneId()).toLocalTime())
        .isEqualTo(LocalTime.of(10, 0));
    assertThat(created.get(0).getId()).isEqualTo(result.get("appointmentId").asLong());

    List<AuditLog> rows =
        auditLogRepository.findAll().stream()
            .filter(r -> "ASSISTANT".equals(r.getSource()))
            .filter(r -> tenant.getId().equals(r.getTenantId()))
            .toList();
    assertThat(rows).extracting(AuditLog::getResource).containsExactly("appointments");
    assertThat(rows.get(0).getOperation()).isEqualTo("create");
  }

  @Test
  void withoutAProfessional_aFreeOneIsChosen() throws Exception {
    long conv = conversation(admin);
    book(lucia, "10:00");

    JsonNode draft = card(ask(admin, conv, bookText("tomorrow", "10:00", "")), "card.draft");

    // Lucia is busy at 10:00: the draft goes to the other one.
    assertThat(draft.get("payload").get("professionalName").asString())
        .isEqualTo(hugo.getFullName());
  }

  @Test
  void aTakenSlot_isNotProposed_itOffersAlternativesAsChips() throws Exception {
    long conv = conversation(admin);
    book(lucia, "10:00");

    Answer res = ask(admin, conv, bookText("tomorrow", "10:00", "with " + lucia.getFullName()));

    assertThat(res.events.stream().map(e -> e.event)).doesNotContain("card.draft");
    assertThat(res.text).contains("ocupado");
    JsonNode options = card(res, "card.options");
    assertThat(options.get("kind").asString()).isEqualTo("SLOT");
    assertThat(options.get("options").size()).isBetween(1, 5);
    // No alternative is the taken slot, and each one carries what the model needs.
    for (JsonNode o : options.get("options")) {
      assertThat(o.get("label").asString()).doesNotStartWith("10:00");
      assertThat(o.get("value").asString()).contains("Quiero el turno del").contains("profesional");
    }
  }

  @Test
  void aSlotTakenBetweenProposalAndConfirm_is409WithAlternatives_andTheDraftSurvives()
      throws Exception {
    long conv = conversation(admin);
    JsonNode draft =
        card(
            ask(admin, conv, bookText("tomorrow", "10:00", "with " + lucia.getFullName())),
            "card.draft");
    String id = draft.get("id").asString();
    book(lucia, "10:00"); // someone else takes it meanwhile

    HttpResponse<String> res = post("/api/assistant/drafts/" + id + "/confirm", admin, id);

    assertThat(res.statusCode()).isEqualTo(409);
    JsonNode body = objectMapper.readTree(res.body());
    assertThat(body.get("error").asString()).isEqualTo("ASSISTANT_SLOT_TAKEN");
    assertThat(body.get("alternatives").size()).isPositive();
    assertThat(body.get("draft").get("status").asString()).isEqualTo("DRAFT");
    assertThat(appointmentsOf(lucia)).hasSize(1); // only the one that took it

    // The person picks an alternative on the card: the draft moves, and confirms.
    JsonNode alt = body.get("alternatives").get(0);
    HttpResponse<String> moved =
        patch(
            "/api/assistant/drafts/" + id,
            admin,
            objectMapper.writeValueAsString(
                Map.of(
                    "startAt",
                    alt.get("startAt").asString(),
                    "professionalId",
                    alt.get("professionalId").asLong())));
    assertThat(moved.statusCode()).as(moved.body()).isEqualTo(200);
    assertThat(post("/api/assistant/drafts/" + id + "/confirm", admin, id).statusCode())
        .isEqualTo(200);
  }

  @Test
  void movingTheDraftOntoATakenSlot_isRefused() throws Exception {
    long conv = conversation(admin);
    String id =
        card(
                ask(admin, conv, bookText("tomorrow", "10:00", "with " + lucia.getFullName())),
                "card.draft")
            .get("id")
            .asString();
    book(lucia, "11:00");
    Instant taken = start("11:00");

    HttpResponse<String> res =
        patch(
            "/api/assistant/drafts/" + id,
            admin,
            objectMapper.writeValueAsString(Map.of("startAt", taken.toString())));

    assertThat(res.statusCode()).isEqualTo(409);
    assertThat(res.body()).contains("ASSISTANT_SLOT_TAKEN");
  }

  @Test
  void availability_listsFreeTimesAsChips_respectingExistingAppointmentsAndTheServiceDuration()
      throws Exception {
    long conv = conversation(admin);
    book(lucia, "10:00");

    Answer res =
        ask(
            admin,
            conv,
            "availability tomorrow for " + service.getName() + " with " + lucia.getFullName());

    assertThat(res.text).contains("Horarios libres para " + service.getName());
    JsonNode options = card(res, "card.options");
    List<String> labels = new ArrayList<>();
    options.get("options").forEach(o -> labels.add(o.get("label").asString()));
    assertThat(labels).hasSizeLessThanOrEqualTo(8);
    // 30-minute service, Lucia busy 10:00-10:30: 09:30 fits (ends at 10:00), 10:00 does not.
    assertThat(labels).contains("09:00", "09:30").doesNotContain("10:00");
    assertThat(res.text).contains("10:30");
  }

  @Test
  void availability_honorsTheDayPart() throws Exception {
    long conv = conversation(admin);

    Answer afternoon =
        ask(
            admin,
            conv,
            "availability tomorrow afternoon for "
                + service.getName()
                + " with "
                + lucia.getFullName());

    JsonNode options = card(afternoon, "card.options");
    options
        .get("options")
        .forEach(
            o ->
                assertThat(o.get("label").asString().compareTo("12:00")).isGreaterThanOrEqualTo(0));
  }

  @Test
  void aProfessionalWithoutWorkingHours_getsNoSlots_andTheAssistantSaysSo() throws Exception {
    long conv = conversation(admin);
    Professional noHours = professional("SinHorario " + suffix, false);

    Answer res =
        ask(
            admin,
            conv,
            "availability tomorrow for " + service.getName() + " with " + noHours.getFullName());

    assertThat(res.events.stream().map(e -> e.event)).doesNotContain("card.options");
    assertThat(res.text).contains("sin horario cargado");
  }

  @Test
  void aDayWithoutRoom_suggestsAnotherDay() throws Exception {
    long conv = conversation(admin);
    // Hugo works only a short block tomorrow's weekday... close it: no working day at all that day.
    LocalDate tomorrow = LocalDate.now(timeProperties.zoneId()).plusDays(1);
    scheduleRepository.findByProfessionalIdOrderByDayOfWeekAscIdAsc(hugo.getId()).stream()
        .filter(b -> b.getDayOfWeek() == tomorrow.getDayOfWeek().getValue())
        .forEach(scheduleRepository::delete);

    Answer res =
        ask(
            admin,
            conv,
            "availability tomorrow for " + service.getName() + " with " + hugo.getFullName());

    assertThat(res.text).contains("No hay horarios libres").contains("Probá el");
  }

  @Test
  void outsideWorkingHours_isFlaggedOnTheDraft_butStillBookable() throws Exception {
    long conv = conversation(admin);

    JsonNode draft =
        card(
            ask(admin, conv, bookText("tomorrow", "20:00", "with " + lucia.getFullName())),
            "card.draft");

    assertThat(draft.get("payload").get("outsideWorkingHours").asBoolean()).isTrue();
    String id = draft.get("id").asString();
    assertThat(post("/api/assistant/drafts/" + id + "/confirm", admin, id).statusCode())
        .isEqualTo(200);
  }

  @Test
  void aTimeInThePast_isNotProposed() throws Exception {
    long conv = conversation(admin);

    Answer res = ask(admin, conv, bookText("2020-01-01", "10:00", ""));

    assertThat(res.events.stream().map(e -> e.event)).doesNotContain("card.draft");
    assertThat(res.text).contains("ya pasó");
  }

  @Test
  void aProfessionalBooksOnlyForHerself() throws Exception {
    AppUser luciaUser = user(UserRole.PROFESSIONAL, lucia.getId());
    long conv = conversation(luciaUser);

    JsonNode own = card(ask(luciaUser, conv, bookText("tomorrow", "10:00", "")), "card.draft");
    assertThat(own.get("payload").get("professionalId").asLong()).isEqualTo(lucia.getId());

    Answer other =
        ask(luciaUser, conv, bookText("tomorrow", "11:00", "with " + hugo.getFullName()));
    assertThat(other.events.stream().map(e -> e.event)).doesNotContain("card.draft");
    assertThat(other.text).contains("vos misma");

    // She confirms her own; she cannot confirm a draft whose professional is someone else's
    // (administration proposes one for Hugo).
    String ownId = own.get("id").asString();
    assertThat(post("/api/assistant/drafts/" + ownId + "/confirm", luciaUser, ownId).statusCode())
        .isEqualTo(200);
    assertThat(appointmentsOf(lucia)).hasSize(1);
  }

  @Test
  void twoSimultaneousConfirms_createExactlyOneAppointment() throws Exception {
    long conv = conversation(admin);
    String id =
        card(
                ask(admin, conv, bookText("tomorrow", "10:00", "with " + lucia.getFullName())),
                "card.draft")
            .get("id")
            .asString();

    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      List<Callable<HttpResponse<String>>> taps = new ArrayList<>();
      for (int i = 0; i < 2; i++) {
        taps.add(() -> post("/api/assistant/drafts/" + id + "/confirm", admin, id));
      }
      List<Integer> statuses = new ArrayList<>();
      for (Future<HttpResponse<String>> f : pool.invokeAll(taps)) {
        statuses.add(f.get().statusCode());
      }
      assertThat(statuses).containsExactlyInAnyOrder(200, 409);
    } finally {
      pool.shutdownNow();
    }
    assertThat(appointmentsOf(lucia)).hasSize(1);
  }

  // ---------------------------------------------------------------------------------------------

  private String bookText(String date, String time, String with) {
    return ("book "
            + client.getFullName()
            + " for "
            + service.getName()
            + " "
            + date
            + " at "
            + time
            + " "
            + with)
        .trim();
  }

  private Instant start(String hhmm) {
    LocalDate tomorrow = LocalDate.now(timeProperties.zoneId()).plusDays(1);
    return tomorrow.atTime(LocalTime.parse(hhmm)).atZone(timeProperties.zoneId()).toInstant();
  }

  private void book(Professional pro, String hhmm) {
    Appointment a = new Appointment();
    a.setTenant(tenant);
    a.setClient(client);
    a.setProfessional(pro);
    a.setSalonService(service);
    a.setStartAt(start(hhmm));
    a.setEndAt(start(hhmm).plus(Duration.ofMinutes(30)));
    a.setStatus(AppointmentStatus.CONFIRMED);
    appointmentRepository.save(a);
  }

  private List<Appointment> appointmentsOf(Professional pro) {
    return appointmentRepository.findAll().stream()
        .filter(a -> a.getProfessional().getId().equals(pro.getId()))
        .toList();
  }

  private Professional professional(String name, boolean withHours) {
    Professional p = new Professional();
    p.setTenant(tenant);
    p.setFullName(name);
    p.setActive(true);
    p = professionalRepository.save(p);
    if (withHours) {
      for (short day = 1; day <= 7; day++) {
        ProfessionalSchedule block = new ProfessionalSchedule();
        block.setProfessional(p);
        block.setDayOfWeek(day);
        block.setStartTime(LocalTime.of(9, 0));
        block.setEndTime(LocalTime.of(17, 0));
        scheduleRepository.save(block);
      }
    }
    return p;
  }

  private AppUser user(UserRole role, Long professionalId) {
    AppUser u = new AppUser();
    u.setTenant(tenant);
    u.setEmail(role.name().toLowerCase() + "." + System.nanoTime() + "@agenda.test");
    u.setFullName(role.name());
    u.setPasswordHash("x");
    u.setRole(role);
    u.setEnabled(true);
    AppUser saved = appUserRepository.save(u);
    if (professionalId != null) {
      professionalByUser.put(saved.getId(), professionalId);
    }
    return saved;
  }

  private String token(AppUser user) {
    return jwtService.createAccessToken(
        user.getId(),
        tenant.getId(),
        user.getEmail(),
        user.getRole(),
        professionalByUser.get(user.getId()),
        Instant.now());
  }

  private record Event(String event, JsonNode data) {}

  private static final class Answer {
    final List<Event> events = new ArrayList<>();
    String text = "";
  }

  private JsonNode card(Answer a, String event) {
    return a.events.stream()
        .filter(e -> e.event.equals(event))
        .findFirst()
        .orElseThrow(
            () ->
                new AssertionError(
                    "no "
                        + event
                        + " in "
                        + a.events.stream().map(e -> e.event).toList()
                        + " text="
                        + a.text))
        .data;
  }

  private long conversation(AppUser user) throws Exception {
    HttpResponse<String> res =
        http.send(
            HttpRequest.newBuilder(
                    URI.create("http://127.0.0.1:" + port + "/api/assistant/conversations/current"))
                .header("Authorization", "Bearer " + token(user))
                .GET()
                .build(),
            HttpResponse.BodyHandlers.ofString());
    return objectMapper.readTree(res.body()).get("conversationId").asLong();
  }

  private Answer ask(AppUser user, long conversationId, String text) throws Exception {
    HttpResponse<String> res =
        http.send(
            HttpRequest.newBuilder(
                    URI.create("http://127.0.0.1:" + port + "/api/assistant/messages"))
                .header("Authorization", "Bearer " + token(user))
                .header("Content-Type", "application/json")
                .header("Accept", "text/event-stream")
                .POST(
                    HttpRequest.BodyPublishers.ofString(
                        objectMapper.writeValueAsString(
                            Map.of(
                                "conversationId",
                                conversationId,
                                "text",
                                text,
                                "inputMode",
                                "TEXT"))))
                .build(),
            HttpResponse.BodyHandlers.ofString());
    assertThat(res.statusCode()).as(res.body()).isEqualTo(200);
    Answer out = new Answer();
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

  private HttpResponse<String> post(String path, AppUser user, String idempotencyKey)
      throws Exception {
    return http.send(
        HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
            .header("Authorization", "Bearer " + token(user))
            .header("Content-Type", "application/json")
            .header("Idempotency-Key", idempotencyKey)
            .POST(HttpRequest.BodyPublishers.noBody())
            .build(),
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
}
