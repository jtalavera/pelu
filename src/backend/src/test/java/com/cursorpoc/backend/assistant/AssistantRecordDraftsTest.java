package com.cursorpoc.backend.assistant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.assistant.AssistantDraftPayloads.ServiceRecordDraftPayload;
import com.cursorpoc.backend.assistant.AssistantDraftPayloads.ServiceRecordDraftPayload.Line;
import com.cursorpoc.backend.assistant.AssistantRecordDrafts.Request;
import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.ServiceRecord;
import com.cursorpoc.backend.domain.ServiceRecordLine;
import com.cursorpoc.backend.domain.enums.ServiceRecordStatus;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.ServiceRecordRepository;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.AppointmentService;
import com.cursorpoc.backend.service.AppointmentServiceRecordService;
import com.cursorpoc.backend.service.ClientService;
import com.cursorpoc.backend.service.ProfessionalDirectoryService;
import com.cursorpoc.backend.service.ServiceCatalogService;
import com.cursorpoc.backend.service.ServiceRecordService;
import com.cursorpoc.backend.web.dto.AppointmentResponse;
import com.cursorpoc.backend.web.dto.ClientResponse;
import com.cursorpoc.backend.web.dto.ProfessionalOptionResponse;
import com.cursorpoc.backend.web.dto.ServiceRecordRequest;
import com.cursorpoc.backend.web.dto.ServiceRecordResponse;
import com.cursorpoc.backend.web.dto.ServiceRecordTipResponse;
import com.cursorpoc.backend.web.dto.ServiceResponse;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

/** What a ficha draft would change, for each role, and the services it becomes on «Guardar». */
class AssistantRecordDraftsTest {

  private static final long TENANT = 7L;
  private static final long OTHER_TENANT_CLIENT = 99L;

  private static final AssistantContext ADMIN =
      new AssistantContext(TENANT, 1L, UserRole.ADMIN, null, "", 5L);
  private static final AssistantContext PRO =
      new AssistantContext(TENANT, 2L, UserRole.PROFESSIONAL, 9L, "", 5L);

  private final ClientService clients = mock(ClientService.class);
  private final ServiceCatalogService catalog = mock(ServiceCatalogService.class);
  private final ProfessionalDirectoryService professionals =
      mock(ProfessionalDirectoryService.class);
  private final AppointmentService appointments = mock(AppointmentService.class);
  private final ServiceRecordRepository records = mock(ServiceRecordRepository.class);
  private final ServiceRecordService recordService = mock(ServiceRecordService.class);
  private final AppointmentServiceRecordService appointmentRecords =
      mock(AppointmentServiceRecordService.class);
  private final AssistantRecordDrafts drafts =
      new AssistantRecordDrafts(
          clients,
          catalog,
          professionals,
          appointments,
          records,
          recordService,
          appointmentRecords,
          new FemmeTimeProperties());
  private final JsonMapper json = JsonMapper.builder().build();

  @BeforeEach
  void setUp() {
    when(catalog.listServices(eq(TENANT), eq(Optional.empty()), any(), isNull()))
        .thenReturn(
            List.of(
                service(1, "Corte", 50_000, true),
                service(2, "Tintura", 120_000, true),
                service(3, "Servicio viejo", 10_000, false),
                service(4, "Shampoo", 20_000, true)));
    when(professionals.listOptions(TENANT))
        .thenReturn(
            List.of(
                new ProfessionalOptionResponse(9, "Lucia Perez", "Lu", "Lu", true),
                new ProfessionalOptionResponse(10, "Hugo Diaz", "Hugo", "Hugo", true)));
    when(clients.getById(TENANT, 42)).thenReturn(client(42, "MARIA GOMEZ"));
    when(clients.getById(TENANT, OTHER_TENANT_CLIENT))
        .thenThrow(new ResponseStatusException(HttpStatus.NOT_FOUND, "CLIENT_NOT_FOUND"));
  }

  // ---------------------------------------------------------------------------------------------
  // Creating

  @Test
  void createsLinkedToTheOnlyAppointmentOfToday() {
    todayAppointments(appointment(70, 1, 9, "PENDING", null));

    ServiceRecordDraftPayload p = drafts.build(ADMIN, req(add(2, 1)), Optional.empty());

    assertThat(p.serviceRecordId()).isNull();
    assertThat(p.appointmentId()).isEqualTo(70L);
    assertThat(p.appointmentTime()).isNotNull();
    assertThat(p.lines()).hasSize(2);
    assertThat(p.lines().get(0).name()).isEqualTo("Corte"); // the turno's own line
    assertThat(p.lines().get(0).mark()).isEqualTo("KEPT");
    assertThat(p.lines().get(0).professionalId()).isEqualTo(9L);
    assertThat(p.lines().get(1).name()).isEqualTo("Tintura");
    assertThat(p.lines().get(1).mark()).isEqualTo("NEW");
    assertThat(p.total()).isEqualByComparingTo("170000");
  }

  @Test
  void createsLooseWhenAdminHasNoAppointmentToday() {
    ServiceRecordDraftPayload p = drafts.build(ADMIN, req(add(2, 2)), Optional.empty());

    assertThat(p.appointmentId()).isNull();
    assertThat(p.lines()).hasSize(1);
    assertThat(p.lines().get(0).quantity()).isEqualTo(2);
    assertThat(p.total()).isEqualByComparingTo("240000");
  }

  @Test
  void professionalWithoutOwnAppointmentGetsNoAppointmentToday() {
    todayAppointments(appointment(71, 1, 10, "PENDING", null)); // another professional's

    assertThatThrownBy(() -> drafts.build(PRO, req(add(2, 1)), Optional.empty()))
        .hasMessage("NO_APPOINTMENT_TODAY");
  }

  @Test
  void professionalOnAnotherProfessionalsAppointmentIsRefused() {
    when(appointments.get(TENANT, 71)).thenReturn(appointment(71, 1, 10, "PENDING", null));
    Request r = new Request(42L, 71L, null, false, List.of(add(2, 1)), List.of(), List.of());

    assertThatThrownBy(() -> drafts.build(PRO, r, Optional.empty()))
        .hasMessage("APPOINTMENT_NOT_OWNED_BY_PROFESSIONAL");
  }

  @Test
  void severalAppointmentsToday_askWhich() {
    todayAppointments(
        appointment(70, 1, 9, "PENDING", null), appointment(72, 2, 9, "CONFIRMED", null));

    assertThatThrownBy(() -> drafts.build(ADMIN, req(add(4, 1)), Optional.empty()))
        .isInstanceOfSatisfying(
            AssistantTools.ToolException.class,
            e -> {
              assertThat(e.getMessage()).isEqualTo("MULTIPLE_APPOINTMENTS");
              assertThat((List<?>) e.extra().get("appointments")).hasSize(2);
              assertThat(json.writeValueAsString(e.extra())).doesNotContain("price", "total");
            });
  }

  @Test
  void appointmentAlreadyWithAFicha_isNotOffered() {
    todayAppointments(appointment(70, 1, 9, "IN_PROGRESS", 500L));

    ServiceRecordDraftPayload p = drafts.build(ADMIN, req(add(2, 1)), Optional.empty());

    assertThat(p.appointmentId()).isNull(); // loose: that turno already has its ficha
  }

  @Test
  void nothingToSave_whenCreatingWithoutAnythingToAdd() {
    assertThatThrownBy(() -> drafts.build(ADMIN, req(), Optional.empty()))
        .hasMessage("NOTHING_TO_SAVE");
  }

  // ---------------------------------------------------------------------------------------------
  // Editing

  @Test
  void editsTheOnlyOpenRecordOfToday() {
    openRecords(
        record(500, Instant.now(), line(1, "Corte", 9L, 1, 50_000), line(2, null, 9L, 1, 120_000)));
    // Positions are the ones the person saw (the saved list): drop #1 and change #2 together.
    Request r =
        new Request(
            42L,
            null,
            null,
            false,
            List.of(add(4, 1)),
            List.of(1),
            List.of(new AssistantRecordDrafts.ChangeReq(2, 3, null, null)));

    ServiceRecordDraftPayload p = drafts.build(ADMIN, r, Optional.empty());

    assertThat(p.serviceRecordId()).isEqualTo(500L);
    assertThat(p.recordFingerprint()).isNotNull();
    List<Line> live = p.lines().stream().filter(l -> !"REMOVED".equals(l.mark())).toList();
    assertThat(live).extracting(Line::name).containsExactly("Tintura", "Shampoo");
    assertThat(live.get(0).quantity()).isEqualTo(3);
    assertThat(live.get(0).mark()).isEqualTo("CHANGED");
    assertThat(live.get(1).mark()).isEqualTo("NEW");
    assertThat(live).extracting(Line::position).containsExactly(1, 2);
    assertThat(p.lines())
        .filteredOn(l -> "REMOVED".equals(l.mark()))
        .extracting(Line::name)
        .containsExactly("Corte");
    assertThat(p.total()).isEqualByComparingTo("380000"); // 3 × 120.000 + 20.000
  }

  @Test
  void severalOpenRecordsOfToday_askWhich() {
    openRecords(
        record(500, Instant.now(), line(1, "Corte", 9L, 1, 50_000)),
        record(501, Instant.now(), line(2, "Tintura", 9L, 1, 120_000)));

    assertThatThrownBy(() -> drafts.build(ADMIN, req(add(4, 1)), Optional.empty()))
        .isInstanceOfSatisfying(
            AssistantTools.ToolException.class,
            e -> {
              assertThat(e.getMessage()).isEqualTo("MULTIPLE_RECORDS");
              assertThat((List<?>) e.extra().get("records")).hasSize(2);
            });
  }

  @Test
  void aStaleOpenRecord_asksFirst_thenEditsItOrOpensANewOne() {
    Instant threeDaysAgo = Instant.now().minus(3, ChronoUnit.DAYS);
    openRecords(record(500, threeDaysAgo, line(1, "Corte", 9L, 1, 50_000)));

    assertThatThrownBy(() -> drafts.build(ADMIN, req(add(4, 1)), Optional.empty()))
        .isInstanceOfSatisfying(
            AssistantTools.ToolException.class,
            e -> {
              assertThat(e.getMessage()).isEqualTo("STALE_RECORD");
              assertThat(e.extra()).containsKey("records");
            });

    Request edit = new Request(42L, null, 500L, false, List.of(add(4, 1)), List.of(), List.of());
    assertThat(drafts.build(ADMIN, edit, Optional.empty()).serviceRecordId()).isEqualTo(500L);

    Request fresh = new Request(42L, null, null, true, List.of(add(4, 1)), List.of(), List.of());
    assertThat(drafts.build(ADMIN, fresh, Optional.empty()).serviceRecordId()).isNull();
  }

  @Test
  void professionalDoesNotSeeStaleRecords() {
    openRecords(
        record(500, Instant.now().minus(3, ChronoUnit.DAYS), line(1, "Corte", 9L, 1, 50_000)));
    todayAppointments(appointment(70, 1, 9, "PENDING", null));

    ServiceRecordDraftPayload p = drafts.build(PRO, req(add(2, 1)), Optional.empty());

    assertThat(p.serviceRecordId()).isNull(); // creates from her turno; never edits yesterday's
    assertThat(p.appointmentId()).isEqualTo(70L);
  }

  @Test
  void nothingToSave_whenRemovingEveryLine() {
    openRecords(record(500, Instant.now(), line(1, "Corte", 9L, 1, 50_000)));
    Request r = new Request(42L, null, null, false, List.of(), List.of(1), List.of());

    assertThatThrownBy(() -> drafts.build(ADMIN, r, Optional.empty()))
        .hasMessage("NOTHING_TO_SAVE");
  }

  @Test
  void rejectsInvalidArguments() {
    openRecords(record(500, Instant.now(), line(1, "Corte", 9L, 1, 50_000)));

    for (int q : new int[] {0, -1, 100}) {
      assertThatThrownBy(() -> drafts.build(ADMIN, req(add(2, q)), Optional.empty()))
          .hasMessage("INVALID_ARGUMENTS");
    }
    Request badPosition = new Request(42L, null, null, false, List.of(), List.of(5), List.of());
    assertThatThrownBy(() -> drafts.build(ADMIN, badPosition, Optional.empty()))
        .hasMessage("INVALID_LINE_POSITION");
    Request badPrice = req(new AssistantRecordDrafts.Add(2L, 1, null, BigDecimal.valueOf(-1)));
    assertThatThrownBy(() -> drafts.build(ADMIN, badPrice, Optional.empty()))
        .hasMessage("INVALID_PRICE");
    assertThatThrownBy(() -> drafts.build(ADMIN, req(add(3, 1)), Optional.empty()))
        .hasMessage("SERVICE_NOT_FOUND"); // inactive item
  }

  @Test
  void adminPriceSaid_isKept() {
    ServiceRecordDraftPayload p =
        drafts.build(
            ADMIN,
            req(new AssistantRecordDrafts.Add(2L, 1, null, BigDecimal.valueOf(100_000))),
            Optional.empty());

    assertThat(p.lines().get(0).unitPrice()).isEqualByComparingTo("100000");
    assertThat(p.total()).isEqualByComparingTo("100000");
  }

  @Test
  void professionalCannotSetPrices() {
    todayAppointments(appointment(70, 1, 9, "PENDING", null));
    Request priced = req(new AssistantRecordDrafts.Add(2L, 1, null, BigDecimal.valueOf(100_000)));

    assertThatThrownBy(() -> drafts.build(PRO, priced, Optional.empty()))
        .hasMessage("PRICE_NOT_ALLOWED");
    Request change =
        new Request(
            42L,
            null,
            null,
            false,
            List.of(),
            List.of(),
            List.of(new AssistantRecordDrafts.ChangeReq(1, null, null, BigDecimal.TEN)));
    assertThatThrownBy(() -> drafts.build(PRO, change, Optional.empty()))
        .hasMessage("PRICE_NOT_ALLOWED");
  }

  @Test
  void aLineAddedByAProfessionalWithoutAProfessionalIsHers() {
    todayAppointments(appointment(70, 1, 9, "PENDING", null));

    ServiceRecordDraftPayload p = drafts.build(PRO, req(add(2, 1)), Optional.empty());

    assertThat(p.lines().get(1).professionalId()).isEqualTo(9L);
  }

  // ---------------------------------------------------------------------------------------------
  // The professional never sees money

  @Test
  void professionalPayloadHasNoAmounts() throws Exception {
    todayAppointments(appointment(70, 1, 9, "PENDING", null));

    ServiceRecordDraftPayload p = drafts.build(PRO, req(add(2, 1)), Optional.empty());

    assertThat(p.total()).isNull();
    assertThat(p.lines())
        .allSatisfy(
            l -> {
              assertThat(l.unitPrice()).isNull();
              assertThat(l.lineTotal()).isNull();
            });
    assertThat(json.writeValueAsString(p)).doesNotContain("unitPrice", "lineTotal", "total");
  }

  @Test
  void professionalErrorsAndReadingCarryNoAmounts() throws Exception {
    openRecords(
        record(500, Instant.now(), line(1, "Corte", 9L, 1, 50_000)),
        record(501, Instant.now(), line(2, "Tintura", 9L, 1, 120_000)));

    assertThatThrownBy(() -> drafts.build(PRO, req(add(4, 1)), Optional.empty()))
        .isInstanceOfSatisfying(
            AssistantTools.ToolException.class,
            e ->
                assertThat(json.writeValueAsString(e.extra()))
                    .doesNotContain("price", "Price", "total", "Total", "Gs."));

    String view = json.writeValueAsString(drafts.view(PRO, 42L, Optional.empty()));
    assertThat(view).contains("Corte").doesNotContain("price", "Price", "total", "Total", "Gs.");
  }

  @Test
  void adminReadingShowsMoney() throws Exception {
    openRecords(record(500, Instant.now(), line(1, "Corte", 9L, 1, 50_000)));

    String view = json.writeValueAsString(drafts.view(ADMIN, 42L, Optional.empty()));

    assertThat(view).contains("Corte").contains("Gs. 50.000");
  }

  // ---------------------------------------------------------------------------------------------
  // On top of a pending draft, and when the ficha changes

  @Test
  void changesApplyOnTopOfAPendingDraft_withThePositionsOfItsList() {
    openRecords(
        record(500, Instant.now(), line(1, "Corte", 9L, 1, 50_000), line(2, null, 9L, 1, 120_000)));
    ServiceRecordDraftPayload first =
        drafts.build(
            ADMIN,
            new Request(42L, null, null, false, List.of(), List.of(1), List.of()),
            Optional.empty()); // [Tintura]

    // «#1» now means Tintura, because that is the list on the card.
    Request again =
        new Request(
            42L,
            null,
            null,
            false,
            List.of(),
            List.of(),
            List.of(new AssistantRecordDrafts.ChangeReq(1, 2, null, null)));
    ServiceRecordDraftPayload second = drafts.build(ADMIN, again, Optional.of(first));

    List<Line> live = second.lines().stream().filter(l -> !"REMOVED".equals(l.mark())).toList();
    assertThat(live).extracting(Line::name).containsExactly("Tintura");
    assertThat(live.get(0).quantity()).isEqualTo(2);
    assertThat(second.changes()).hasSize(2); // the removal of Corte AND the new quantity
  }

  @Test
  void anExplicitTargetOtherThanThePendingOnesStartsFresh_butTheSameFichaKeepsTheDraft() {
    openRecords(
        record(500, Instant.now(), line(1, "Corte", 9L, 1, 50_000)),
        record(501, Instant.now(), line(2, null, 9L, 1, 120_000)));
    ServiceRecordDraftPayload pending =
        drafts.build(
            ADMIN,
            new Request(42L, null, 500L, false, List.of(add(4, 1)), List.of(), List.of()),
            Optional.empty());

    // The same ficha, said explicitly: what was asked before is kept.
    ServiceRecordDraftPayload same =
        drafts.build(
            ADMIN,
            new Request(42L, null, 500L, false, List.of(add(2, 1)), List.of(), List.of()),
            Optional.of(pending));
    assertThat(same.serviceRecordId()).isEqualTo(500L);
    assertThat(same.changes()).hasSize(2);

    // Another ficha, or a new one: the person moved on from the pending card.
    ServiceRecordDraftPayload other =
        drafts.build(
            ADMIN,
            new Request(42L, null, 501L, false, List.of(add(4, 1)), List.of(), List.of()),
            Optional.of(pending));
    assertThat(other.serviceRecordId()).isEqualTo(501L);
    assertThat(other.changes()).hasSize(1);

    ServiceRecordDraftPayload fresh =
        drafts.build(
            ADMIN,
            new Request(42L, null, null, true, List.of(add(4, 1)), List.of(), List.of()),
            Optional.of(pending));
    assertThat(fresh.serviceRecordId()).isNull();
    assertThat(fresh.lines()).extracting(Line::name).containsExactly("Shampoo");
  }

  @Test
  void aChangeThatMovesALine_doesNotShiftWhatARemovalOfTheSameRequestPointsAt() {
    // #1 Corte·Hugo ×1 and #2 Corte·Lu ×2: «pass #1 to Lu and drop #2».
    openRecords(
        record(
            500, Instant.now(), line(1, "Corte", 10L, 1, 50_000), line(1, "Corte", 9L, 2, 50_000)));
    Request r =
        new Request(
            42L,
            null,
            null,
            false,
            List.of(),
            List.of(2),
            List.of(new AssistantRecordDrafts.ChangeReq(1, null, 9L, null)));

    ServiceRecordDraftPayload p = drafts.build(ADMIN, r, Optional.empty());

    List<Line> live = p.lines().stream().filter(l -> !"REMOVED".equals(l.mark())).toList();
    assertThat(live).hasSize(1);
    assertThat(live.get(0).quantity()).isEqualTo(1); // the former #1, now Lu's
    assertThat(live.get(0).professionalId()).isEqualTo(9L);
    assertThat(live.get(0).mark()).isEqualTo("CHANGED");
    assertThat(p.lines().stream().filter(l -> "REMOVED".equals(l.mark())).toList())
        .extracting(Line::quantity)
        .containsExactly(2); // the former #2 went away, not the one that moved
    assertThat(p.notApplied()).isEmpty();
  }

  @Test
  void twoLinesOfTheSamePair_changeOneAndRemoveTheOther_inOneRequest() {
    openRecords(
        record(
            500,
            Instant.now(),
            line(1, "Corte", 10L, 1, 50_000),
            line(1, "Corte", 10L, 2, 50_000)));
    Request r =
        new Request(
            42L,
            null,
            null,
            false,
            List.of(),
            List.of(2),
            List.of(new AssistantRecordDrafts.ChangeReq(1, null, 9L, null)));

    ServiceRecordDraftPayload p = drafts.build(ADMIN, r, Optional.empty());

    assertThat(p.notApplied())
        .isEmpty(); // «no aplicado» is only for a ficha that changed meanwhile
    List<Line> live = p.lines().stream().filter(l -> !"REMOVED".equals(l.mark())).toList();
    assertThat(live).extracting(Line::quantity).containsExactly(1);
    assertThat(live.get(0).professionalId()).isEqualTo(9L);
  }

  @Test
  void anItemAddedAtAnotherPrice_isNotMergedIntoTheExistingLine() {
    openRecords(record(500, Instant.now(), line(1, "Corte", null, 1, 50_000)));

    ServiceRecordDraftPayload p =
        drafts.build(
            ADMIN,
            req(new AssistantRecordDrafts.Add(1L, 1, null, BigDecimal.valueOf(45_000))),
            Optional.empty());

    assertThat(p.lines()).hasSize(2);
    assertThat(p.lines().get(0).unitPrice()).isEqualByComparingTo("50000"); // untouched
    assertThat(p.lines().get(0).mark()).isEqualTo("KEPT");
    assertThat(p.lines().get(1).unitPrice()).isEqualByComparingTo("45000");
    assertThat(p.lines().get(1).mark()).isEqualTo("NEW");
  }

  @Test
  void anItemAddedWithoutAPrice_isMergedIntoTheExistingLine() {
    openRecords(record(500, Instant.now(), line(1, "Corte", null, 1, 50_000)));

    ServiceRecordDraftPayload p = drafts.build(ADMIN, req(add(1, 1)), Optional.empty());

    assertThat(p.lines()).hasSize(1);
    assertThat(p.lines().get(0).quantity()).isEqualTo(2);
    assertThat(p.lines().get(0).mark()).isEqualTo("CHANGED");
  }

  @Test
  void aProfessionalCannotSaveFromATurnoThatIsNoLongerHers() {
    todayAppointments(appointment(70, 1, 9, "PENDING", null));
    ServiceRecordDraftPayload p = drafts.build(PRO, req(add(2, 1)), Optional.empty());
    // The turno is reassigned to another professional while the card waits (it lives 24 h).
    when(appointments.get(TENANT, 70)).thenReturn(appointment(70, 1, 10, "PENDING", null));

    assertThatThrownBy(() -> drafts.rebase(PRO, p))
        .hasMessage("APPOINTMENT_NOT_OWNED_BY_PROFESSIONAL");
  }

  @Test
  void aPendingCardBuiltFromATurnoThatGotItsFichaIsStale_soTheNextProposalStartsFresh() {
    todayAppointments(appointment(70, 1, 9, "PENDING", null));
    ServiceRecordDraftPayload pending = drafts.build(ADMIN, req(add(2, 1)), Optional.empty());
    // The agenda created the turno's ficha meanwhile.
    todayAppointments(appointment(70, 1, 9, "IN_PROGRESS", 500L));
    when(appointments.get(TENANT, 70)).thenReturn(appointment(70, 1, 9, "IN_PROGRESS", 500L));

    ServiceRecordDraftPayload p = drafts.build(ADMIN, req(add(4, 1)), Optional.of(pending));

    assertThat(p.appointmentId()).isNull(); // not stuck on a draft that can no longer be saved
    assertThat(p.lines()).extracting(Line::name).containsExactly("Shampoo");
    assertThatThrownBy(() -> drafts.rebase(ADMIN, pending))
        .hasMessage("APPOINTMENT_ALREADY_HAS_SERVICE_RECORD");
  }

  @Test
  void removingALineAddedInTheSameDraft_leavesNoTrace() {
    openRecords(record(500, Instant.now(), line(1, "Corte", 9L, 1, 50_000)));
    ServiceRecordDraftPayload first = drafts.build(ADMIN, req(add(4, 1)), Optional.empty());

    ServiceRecordDraftPayload second =
        drafts.build(
            ADMIN,
            new Request(42L, null, null, false, List.of(), List.of(2), List.of()),
            Optional.of(first)); // #2 = Shampoo

    assertThat(second.lines()).extracting(Line::name).containsExactly("Corte");
  }

  @Test
  void rebaseReappliesChangesAndReportsTheLinesThatAreGone() {
    ServiceRecord original =
        record(500, Instant.now(), line(1, "Corte", 9L, 1, 50_000), line(2, null, 9L, 1, 120_000));
    openRecords(original);
    when(records.findByIdAndTenant_Id(500L, TENANT)).thenReturn(Optional.of(original));
    ServiceRecordDraftPayload p =
        drafts.build(
            ADMIN,
            new Request(
                42L,
                null,
                null,
                false,
                List.of(add(4, 1)),
                List.of(2),
                List.of(new AssistantRecordDrafts.ChangeReq(1, 4, null, null))),
            Optional.empty());

    // Meanwhile somebody removed the Tintura from the ficha.
    ServiceRecord changed = record(500, Instant.now(), line(1, "Corte", 9L, 1, 50_000));
    when(records.findByIdAndTenant_Id(500L, TENANT)).thenReturn(Optional.of(changed));

    ServiceRecordDraftPayload fresh = drafts.rebase(ADMIN, p);

    assertThat(fresh.recordFingerprint()).isNotEqualTo(p.recordFingerprint());
    assertThat(fresh.notApplied()).extracting(n -> n.name()).containsExactly("Tintura");
    List<Line> live = fresh.lines().stream().filter(l -> !"REMOVED".equals(l.mark())).toList();
    assertThat(live).extracting(Line::name).containsExactly("Corte", "Shampoo");
    assertThat(live.get(0).quantity()).isEqualTo(4); // the other change still applies
    assertThat(AssistantRecordDrafts.fingerprint(fresh))
        .isNotEqualTo(AssistantRecordDrafts.fingerprint(p));
  }

  @Test
  void rebaseOfAnUnchangedRecordKeepsTheFingerprint() {
    ServiceRecord original = record(500, Instant.now(), line(1, "Corte", 9L, 1, 50_000));
    openRecords(original);
    when(records.findByIdAndTenant_Id(500L, TENANT)).thenReturn(Optional.of(original));
    ServiceRecordDraftPayload p = drafts.build(ADMIN, req(add(4, 1)), Optional.empty());

    ServiceRecordDraftPayload fresh = drafts.rebase(ADMIN, p);

    assertThat(fresh.recordFingerprint()).isEqualTo(p.recordFingerprint());
    assertThat(fresh.notApplied()).isEmpty();
  }

  @Test
  void aPendingDraftWhoseFichaWasClosedIsIgnored_soTheNextProposalStartsFresh() {
    ServiceRecord original = record(500, Instant.now(), line(1, "Corte", 9L, 1, 50_000));
    openRecords(original);
    when(records.findByIdAndTenant_Id(500L, TENANT)).thenReturn(Optional.of(original));
    ServiceRecordDraftPayload pending = drafts.build(ADMIN, req(add(4, 1)), Optional.empty());
    // The ficha is voided: it is no longer in the client's open fichas, and it is not OPEN.
    when(original.getStatus()).thenReturn(ServiceRecordStatus.VOIDED);
    openRecords();
    todayAppointments(appointment(70, 1, 9, "PENDING", null));

    ServiceRecordDraftPayload p = drafts.build(ADMIN, req(add(2, 1)), Optional.of(pending));

    assertThat(p.serviceRecordId()).isNull(); // not the voided one
    assertThat(p.appointmentId()).isEqualTo(70L);
    assertThat(p.lines()).extracting(Line::name).containsExactly("Corte", "Tintura");
  }

  @Test
  void rebaseOfAClosedRecordIsRefused() {
    ServiceRecord original = record(500, Instant.now(), line(1, "Corte", 9L, 1, 50_000));
    openRecords(original);
    when(records.findByIdAndTenant_Id(500L, TENANT)).thenReturn(Optional.of(original));
    ServiceRecordDraftPayload p = drafts.build(ADMIN, req(add(4, 1)), Optional.empty());
    when(original.getStatus()).thenReturn(ServiceRecordStatus.CLOSED);

    assertThatThrownBy(() -> drafts.rebase(ADMIN, p)).hasMessage("SERVICE_RECORD_NOT_OPEN");
  }

  @Test
  void clientOfAnotherTenantIsNotFound() {
    Request r =
        new Request(
            OTHER_TENANT_CLIENT, null, null, false, List.of(add(2, 1)), List.of(), List.of());

    assertThatThrownBy(() -> drafts.build(ADMIN, r, Optional.empty()))
        .hasMessageContaining("CLIENT_NOT_FOUND");
  }

  // ---------------------------------------------------------------------------------------------
  // «Guardar ficha»: the services each role uses

  @Test
  void commitCreatesALooseRecordForTheAdmin() {
    when(recordService.createServiceRecord(eq(TENANT), any())).thenReturn(saved(900));
    ServiceRecordDraftPayload p = drafts.build(ADMIN, req(add(2, 2)), Optional.empty());

    long id = drafts.commit(principal(ADMIN), p);

    assertThat(id).isEqualTo(900L);
    ArgumentCaptor<ServiceRecordRequest> sent = ArgumentCaptor.forClass(ServiceRecordRequest.class);
    verify(recordService).createServiceRecord(eq(TENANT), sent.capture());
    assertThat(sent.getValue().clientId()).isEqualTo(42L);
    assertThat(sent.getValue().lines()).hasSize(1);
    assertThat(sent.getValue().lines().get(0).serviceId()).isEqualTo(2L);
    assertThat(sent.getValue().lines().get(0).quantity()).isEqualTo(2);
    assertThat(sent.getValue().lines().get(0).unitPrice()).isEqualByComparingTo("120000");
  }

  @Test
  void commitCreatesFromTheAppointmentThenSetsTheLinesForTheAdmin() {
    todayAppointments(appointment(70, 1, 9, "PENDING", null));
    when(appointmentRecords.createFromAppointment(TENANT, 70)).thenReturn(saved(800));
    when(recordService.updateServiceRecord(eq(TENANT), eq(800L), any())).thenReturn(saved(800));
    ServiceRecordDraftPayload p = drafts.build(ADMIN, req(add(2, 1)), Optional.empty());

    long id = drafts.commit(principal(ADMIN), p);

    assertThat(id).isEqualTo(800L);
    ArgumentCaptor<ServiceRecordRequest> sent = ArgumentCaptor.forClass(ServiceRecordRequest.class);
    verify(recordService).updateServiceRecord(eq(TENANT), eq(800L), sent.capture());
    assertThat(sent.getValue().lines()).extracting(l -> l.serviceId()).containsExactly(1L, 2L);
  }

  @Test
  void commitEditsForTheAdmin_keepingTheTipsOfProfessionalsThatRemain() {
    ServiceRecord original =
        record(500, Instant.now(), line(1, "Corte", 9L, 1, 50_000), line(2, null, 10L, 1, 120_000));
    openRecords(original);
    ServiceRecordResponse current =
        saved(
            500,
            List.of(
                new ServiceRecordTipResponse(9L, "Lu", BigDecimal.valueOf(5_000)),
                new ServiceRecordTipResponse(10L, "Hugo", BigDecimal.valueOf(7_000))));
    when(recordService.getServiceRecord(TENANT, 500)).thenReturn(current);
    when(recordService.updateServiceRecord(eq(TENANT), eq(500L), any())).thenReturn(saved(500));
    // Hugo's line goes away: his tip cannot stay (the ficha refuses a tip without a line).
    ServiceRecordDraftPayload p =
        drafts.build(
            ADMIN,
            new Request(42L, null, null, false, List.of(), List.of(2), List.of()),
            Optional.empty());

    drafts.commit(principal(ADMIN), p);

    ArgumentCaptor<ServiceRecordRequest> sent = ArgumentCaptor.forClass(ServiceRecordRequest.class);
    verify(recordService).updateServiceRecord(eq(TENANT), eq(500L), sent.capture());
    assertThat(sent.getValue().tips()).extracting(t -> t.professionalId()).containsExactly(9L);
  }

  @Test
  void commitUsesTheProfessionalRoadForAProfessional_withoutPrices() {
    todayAppointments(appointment(70, 1, 9, "PENDING", null));
    when(appointmentRecords.createFromAppointment(TENANT, 70)).thenReturn(saved(800));
    when(recordService.updateServicesAsProfessional(eq(TENANT), eq(800L), any(), eq(9L)))
        .thenReturn(saved(800));
    ServiceRecordDraftPayload p = drafts.build(PRO, req(add(2, 1)), Optional.empty());

    long id = drafts.commit(principal(PRO), p);

    assertThat(id).isEqualTo(800L);
    ArgumentCaptor<ServiceRecordRequest> sent = ArgumentCaptor.forClass(ServiceRecordRequest.class);
    verify(recordService)
        .updateServicesAsProfessional(eq(TENANT), eq(800L), sent.capture(), eq(9L));
    assertThat(sent.getValue().lines()).hasSize(2);
    assertThat(sent.getValue().lines()).allSatisfy(l -> assertThat(l.unitPrice()).isNull());
  }

  @Test
  void commitEditsForAProfessionalThroughHerRoad() {
    ServiceRecord original = record(500, Instant.now(), line(1, "Corte", 9L, 1, 50_000));
    openRecords(original);
    when(recordService.updateServicesAsProfessional(eq(TENANT), eq(500L), any(), eq(9L)))
        .thenReturn(saved(500));
    ServiceRecordDraftPayload p = drafts.build(PRO, req(add(4, 1)), Optional.empty());

    drafts.commit(principal(PRO), p);

    verify(recordService).updateServicesAsProfessional(eq(TENANT), eq(500L), any(), eq(9L));
  }

  // ---------------------------------------------------------------------------------------------

  private static Request req(AssistantRecordDrafts.Add... add) {
    return new Request(42L, null, null, false, List.of(add), List.of(), List.of());
  }

  private static AssistantRecordDrafts.Add add(long id, int quantity) {
    return new AssistantRecordDrafts.Add(id, quantity, null, null);
  }

  private void todayAppointments(AppointmentResponse... list) {
    when(appointments.list(eq(TENANT), any(), any(), isNull(), eq(42L))).thenReturn(List.of(list));
  }

  private void openRecords(ServiceRecord... list) {
    when(records.findByTenantAndClientAndStatusWithLines(TENANT, 42L, ServiceRecordStatus.OPEN))
        .thenReturn(List.of(list));
    for (ServiceRecord r : list) {
      when(records.findByIdAndTenant_Id(r.getId(), TENANT)).thenReturn(Optional.of(r));
    }
  }

  private static ServiceRecordResponse saved(long id) {
    return saved(id, List.of());
  }

  private static ServiceRecordResponse saved(long id, List<ServiceRecordTipResponse> tips) {
    return new ServiceRecordResponse(
        id,
        42L,
        "MARIA GOMEZ",
        null,
        "OPEN",
        BigDecimal.ZERO,
        BigDecimal.ZERO,
        null,
        Instant.now(),
        null,
        null,
        null,
        List.of(),
        tips,
        null,
        null,
        List.of(),
        false);
  }

  private static FemmeUserPrincipal principal(AssistantContext ctx) {
    FemmeUserPrincipal p = mock(FemmeUserPrincipal.class);
    when(p.getTenantId()).thenReturn(ctx.tenantId());
    when(p.getUserId()).thenReturn(ctx.userId());
    when(p.getRole()).thenReturn(ctx.role());
    when(p.getProfessionalId()).thenReturn(ctx.professionalId());
    when(p.isAdmin()).thenReturn(ctx.isAdmin());
    when(p.isProfessional()).thenReturn(ctx.isProfessional());
    return p;
  }

  private static ServiceResponse service(long id, String name, long price, boolean active) {
    return new ServiceResponse(
        id,
        1,
        "Cabello",
        "k",
        null,
        null,
        null,
        name,
        BigDecimal.valueOf(price),
        30,
        active,
        "SERVICE",
        null);
  }

  private static ClientResponse client(long id, String name) {
    return new ClientResponse(
        id, name, "0981", null, null, true, 0, null, null, null, null, null, null, null, null, null,
        null, null, null, null, null);
  }

  private static ServiceRecord record(long id, Instant createdAt, ServiceRecordLine... lines) {
    ServiceRecord r = mock(ServiceRecord.class);
    when(r.getId()).thenReturn(id);
    when(r.getStatus()).thenReturn(ServiceRecordStatus.OPEN);
    when(r.getCreatedAt()).thenReturn(createdAt);
    when(r.getLines()).thenReturn(List.of(lines));
    return r;
  }

  private static long nextLineId = 9000;

  /** A ficha line; {@code description} null means «the catalog's name». */
  private static ServiceRecordLine line(
      long serviceId, String description, Long professionalId, int quantity, long unitPrice) {
    ServiceRecordLine l = mock(ServiceRecordLine.class);
    when(l.getId()).thenReturn(nextLineId++);
    SalonService s = mock(SalonService.class);
    when(s.getId()).thenReturn(serviceId);
    when(l.getSalonService()).thenReturn(s);
    when(l.getDescription()).thenReturn(description);
    when(l.getUnitPrice()).thenReturn(BigDecimal.valueOf(unitPrice));
    when(l.getQuantity()).thenReturn(quantity);
    if (professionalId != null) {
      Professional p = mock(Professional.class);
      when(p.getId()).thenReturn(professionalId);
      when(p.getDisplayName()).thenReturn(professionalId == 9L ? "Lu" : "Hugo");
      when(l.getProfessional()).thenReturn(p);
    }
    return l;
  }

  private static AppointmentResponse appointment(
      long id, long serviceId, long professionalId, String status, Long recordId) {
    return new AppointmentResponse(
        id,
        42L,
        "MARIA GOMEZ",
        professionalId,
        professionalId == 9L ? "Lu" : "Hugo",
        serviceId,
        serviceId == 1 ? "Corte" : "Tintura",
        30,
        Instant.now().toString(),
        Instant.now().plusSeconds(1800).toString(),
        status,
        null,
        null,
        false,
        recordId,
        null);
  }
}
