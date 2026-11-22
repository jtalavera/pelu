package com.cursorpoc.backend.assistant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.assistant.AssistantDraftPayloads.ServiceRecordDraftPayload;
import com.cursorpoc.backend.assistant.AssistantDraftPayloads.ServiceRecordDraftPayload.Line;
import com.cursorpoc.backend.assistant.AssistantModelClient.ToolSpec;
import com.cursorpoc.backend.assistant.ToolOutcome.CardEvent;
import com.cursorpoc.backend.domain.enums.UserRole;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.json.JsonMapper;

/** The two ficha tools: what each role is offered, how a call becomes a request and a card. */
class AssistantRecordToolsTest {

  private static final long TENANT = 7L;
  private static final AssistantContext ADMIN =
      new AssistantContext(TENANT, 1L, UserRole.ADMIN, null, "hoy", 5L);
  private static final AssistantContext PRO =
      new AssistantContext(TENANT, 2L, UserRole.PROFESSIONAL, 9L, "hoy", 5L);

  private final AssistantRecordDrafts drafts = mock(AssistantRecordDrafts.class);
  private final AssistantDraftService draftService = mock(AssistantDraftService.class);
  private final JsonMapper json = JsonMapper.builder().build();
  private final AssistantRecordTools tools = new AssistantRecordTools(drafts, draftService, json);

  @Test
  void bothRolesAreOfferedBothTools() {
    for (AssistantContext ctx : List.of(ADMIN, PRO)) {
      assertThat(tools.specsFor(ctx))
          .extracting(ToolSpec::name)
          .containsExactly("ver_ficha_abierta", "proponer_ficha");
    }
    assertThat(tools.handles("proponer_ficha")).isTrue();
    assertThat(tools.handles("ver_ficha_abierta")).isTrue();
    assertThat(tools.handles("proponer_factura")).isFalse();
  }

  @Test
  void onlyTheAdminSchemaHasAPrice() {
    assertThat(schema(ADMIN, "proponer_ficha")).contains("unitPrice");
    assertThat(schema(PRO, "proponer_ficha")).doesNotContain("unitPrice").doesNotContain("price");
    assertThat(schema(ADMIN, "proponer_ficha")).doesNotContain("tenant").doesNotContain("role");
  }

  @Test
  void verFichaAbiertaReturnsWhatTheDraftsClassReads() {
    when(draftService.activeRecordPayload(ADMIN)).thenReturn(Optional.empty());
    when(drafts.view(ADMIN, 42L, Optional.empty())).thenReturn(Map.of("clientName", "MARIA"));

    ToolOutcome out = tools.run(ADMIN, "ver_ficha_abierta", json.readTree("{\"clientId\":42}"));

    assertThat(json.readTree(out.json()).get("data").get("clientName").asString())
        .isEqualTo("MARIA");
    assertThat(out.cards()).isEmpty();
  }

  @Test
  void verFichaAbiertaNeedsAClient() {
    assertThatThrownBy(() -> tools.run(ADMIN, "ver_ficha_abierta", json.readTree("{}")))
        .hasMessage("CLIENT_REQUIRED");
  }

  @Test
  void proponerFichaTurnsTheArgumentsIntoARequest() {
    when(draftService.activeRecordPayload(ADMIN)).thenReturn(Optional.empty());
    ServiceRecordDraftPayload payload = payload(true);
    when(drafts.build(eq(ADMIN), any(), any())).thenReturn(payload);
    when(draftService.createRecordDraft(ADMIN, payload))
        .thenReturn(new AssistantDraftService.Created(dto("new-id"), List.of()));

    tools.run(
        ADMIN,
        "proponer_ficha",
        json.readTree(
            """
            {"clientId":42,"appointmentId":70,"recordId":500,"newRecord":true,
             "agregar":[{"id":2,"quantity":2,"professionalId":10,"unitPrice":45000}],
             "quitar":[1],
             "cambiar":[{"position":2,"quantity":3}]}
            """));

    ArgumentCaptor<AssistantRecordDrafts.Request> sent =
        ArgumentCaptor.forClass(AssistantRecordDrafts.Request.class);
    verify(drafts).build(eq(ADMIN), sent.capture(), eq(Optional.empty()));
    AssistantRecordDrafts.Request r = sent.getValue();
    assertThat(r.clientId()).isEqualTo(42L);
    assertThat(r.appointmentId()).isEqualTo(70L);
    assertThat(r.recordId()).isEqualTo(500L);
    assertThat(r.newRecord()).isTrue();
    assertThat(r.add()).hasSize(1);
    assertThat(r.add().get(0).id()).isEqualTo(2L);
    assertThat(r.add().get(0).quantity()).isEqualTo(2);
    assertThat(r.add().get(0).professionalId()).isEqualTo(10L);
    assertThat(r.add().get(0).unitPrice()).isEqualByComparingTo("45000");
    assertThat(r.remove()).containsExactly(1);
    assertThat(r.change()).hasSize(1);
    assertThat(r.change().get(0).position()).isEqualTo(2);
    assertThat(r.change().get(0).quantity()).isEqualTo(3);
  }

  @Test
  void proponerFichaCreatesTheDraftAndTheCard_dimmingTheOnesItReplaces() {
    when(draftService.activeRecordPayload(ADMIN)).thenReturn(Optional.empty());
    ServiceRecordDraftPayload payload = payload(true);
    when(drafts.build(eq(ADMIN), any(), any())).thenReturn(payload);
    AssistantDraftDto dto = dto("new-id");
    when(draftService.createRecordDraft(ADMIN, payload))
        .thenReturn(new AssistantDraftService.Created(dto, List.of("old-id")));

    ToolOutcome out =
        tools.run(
            ADMIN,
            "proponer_ficha",
            json.readTree("{\"clientId\":42,\"agregar\":[{\"id\":2,\"quantity\":1}]}"));

    assertThat(out.cards())
        .extracting(CardEvent::event)
        .containsExactly("card.draft.updated", "card.draft");
    assertThat(out.cards().get(0).payload())
        .isEqualTo(Map.of("id", "old-id", "status", "SUPERSEDED"));
    assertThat(out.cards().get(1).payload()).isSameAs(dto);
    var data = json.readTree(out.json()).get("data");
    assertThat(data.get("draftId").asString()).isEqualTo("new-id");
    assertThat(data.get("status").asString()).isEqualTo("DRAFT");
    assertThat(data.get("client").asString()).isEqualTo("MARIA GOMEZ");
    assertThat(data.get("instruction").asString())
        .contains("Guardar ficha")
        .contains("NO se guardó");
  }

  @Test
  void whatTheModelReadsAboutAProfessionalsDraftHasNoAmounts() {
    when(draftService.activeRecordPayload(PRO)).thenReturn(Optional.empty());
    ServiceRecordDraftPayload payload = payload(false);
    when(drafts.build(eq(PRO), any(), any())).thenReturn(payload);
    when(draftService.createRecordDraft(PRO, payload))
        .thenReturn(new AssistantDraftService.Created(dto("new-id"), List.of()));

    ToolOutcome out =
        tools.run(
            PRO,
            "proponer_ficha",
            json.readTree("{\"clientId\":42,\"agregar\":[{\"id\":2,\"quantity\":1}]}"));

    assertThat(out.json())
        .contains("Corte")
        .doesNotContain("price", "Price", "total", "Total", "Gs.");
  }

  @Test
  void aPendingDraftOfTheSameClientIsPassedOn() {
    ServiceRecordDraftPayload pending = payload(true);
    when(draftService.activeRecordPayload(ADMIN)).thenReturn(Optional.of(pending));
    when(drafts.build(eq(ADMIN), any(), eq(Optional.of(pending)))).thenReturn(payload(true));
    when(draftService.createRecordDraft(eq(ADMIN), any()))
        .thenReturn(new AssistantDraftService.Created(dto("new-id"), List.of("old-id")));

    tools.run(ADMIN, "proponer_ficha", json.readTree("{\"clientId\":42,\"quitar\":[1]}"));

    verify(drafts).build(eq(ADMIN), any(), eq(Optional.of(pending)));
  }

  @Test
  void malformedArgumentsAreABadCall() {
    for (String bad :
        List.of(
            "{\"clientId\":42,\"agregar\":[{\"quantity\":2}]}",
            "{\"clientId\":42,\"agregar\":\"x\"}",
            "{\"clientId\":42,\"quitar\":[\"a\"]}",
            "{\"clientId\":42,\"cambiar\":[{\"quantity\":2}]}")) {
      assertThatThrownBy(() -> tools.run(ADMIN, "proponer_ficha", json.readTree(bad)))
          .hasMessage("INVALID_ARGUMENTS");
    }
  }

  @Test
  void quantitiesAndPositionsMustBeWholeNumbers_andPricesWholeGuaranies() {
    for (String bad :
        List.of(
            "{\"clientId\":42,\"agregar\":[{\"id\":2,\"quantity\":1.5}]}",
            "{\"clientId\":42,\"quitar\":[1.5]}",
            "{\"clientId\":42,\"cambiar\":[{\"position\":1.5,\"quantity\":2}]}")) {
      assertThatThrownBy(() -> tools.run(ADMIN, "proponer_ficha", json.readTree(bad)))
          .as(bad)
          .hasMessage("INVALID_ARGUMENTS");
    }
    assertThatThrownBy(
            () ->
                tools.run(
                    ADMIN,
                    "proponer_ficha",
                    json.readTree(
                        "{\"clientId\":42,\"agregar\":[{\"id\":2,\"unitPrice\":45000.5}]}")))
        .hasMessage("INVALID_PRICE");
  }

  @Test
  void withoutAConversationThereIsNowhereToPutTheCard() {
    AssistantContext noConversation = new AssistantContext(TENANT, 1L, UserRole.ADMIN, null, "hoy");

    assertThatThrownBy(
            () -> tools.run(noConversation, "proponer_ficha", json.readTree("{\"clientId\":42}")))
        .hasMessage("NO_CONVERSATION");
  }

  // ---------------------------------------------------------------------------------------------

  private String schema(AssistantContext ctx, String tool) {
    return tools.specsFor(ctx).stream()
        .filter(s -> s.name().equals(tool))
        .findFirst()
        .orElseThrow()
        .parametersSchema();
  }

  private static AssistantDraftDto dto(String id) {
    return new AssistantDraftDto(
        id,
        "SERVICE_RECORD",
        "DRAFT",
        "2026-11-22T10:00:00Z",
        "2026-11-23T10:00:00Z",
        List.of(),
        null,
        null,
        null,
        null);
  }

  private static ServiceRecordDraftPayload payload(boolean money) {
    Line line =
        new Line(
            1,
            1L,
            "Corte",
            1,
            money ? BigDecimal.valueOf(50_000) : null,
            money ? BigDecimal.valueOf(50_000) : null,
            9L,
            "Lu",
            "KEPT");
    return new ServiceRecordDraftPayload(
        42L,
        "MARIA GOMEZ",
        500L,
        null,
        null,
        List.of(line),
        List.of(),
        List.of(),
        money ? BigDecimal.valueOf(50_000) : null,
        "fp");
  }
}
