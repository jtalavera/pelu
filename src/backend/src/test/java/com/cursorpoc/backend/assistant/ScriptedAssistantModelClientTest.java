package com.cursorpoc.backend.assistant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.cursorpoc.backend.assistant.AssistantModelClient.ChatTurn;
import com.cursorpoc.backend.assistant.AssistantModelClient.ModelEvent;
import com.cursorpoc.backend.assistant.AssistantModelClient.ModelRequest;
import com.cursorpoc.backend.assistant.AssistantModelClient.ToolCall;
import com.cursorpoc.backend.assistant.AssistantModelClient.ToolResult;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import tools.jackson.databind.json.JsonMapper;

/** The scripted double decides by patterns, in Spanish and English — e2e relies on it. */
class ScriptedAssistantModelClientTest {

  private final ScriptedAssistantModelClient model =
      new ScriptedAssistantModelClient(JsonMapper.builder().build());

  private List<ModelEvent> ask(ChatTurn... turns) {
    List<ModelEvent> events = new ArrayList<>();
    model.streamTurn(new ModelRequest("sistema", List.of(turns), List.of()), events::add);
    return events;
  }

  private static ToolCall requestedTool(List<ModelEvent> events) {
    return events.stream()
        .filter(ModelEvent.ToolCalls.class::isInstance)
        .map(e -> ((ModelEvent.ToolCalls) e).calls().get(0))
        .findFirst()
        .orElseThrow();
  }

  private static String said(List<ModelEvent> events) {
    StringBuilder sb = new StringBuilder();
    events.stream()
        .filter(ModelEvent.TextDelta.class::isInstance)
        .forEach(e -> sb.append(((ModelEvent.TextDelta) e).text()));
    return sb.toString();
  }

  @ParameterizedTest
  @CsvSource(
      delimiter = '|',
      value = {
        "¿Qué turnos hay hoy?|turnos_del_dia|\"hoy\"",
        "turnos de mañana|turnos_del_dia|\"mañana\"",
        "Which appointments are there today?|turnos_del_dia|\"hoy\"",
        "appointments tomorrow|turnos_del_dia|\"mañana\"",
        "appointments 2031-01-15|turnos_del_dia|\"2031-01-15\"",
        "¿Qué servicios tenemos?|listar_servicios|{}",
        "What services do we offer?|listar_servicios|{}",
        "¿Qué profesionales hay?|listar_profesionales|{}",
        "Which professionals are there?|listar_profesionales|{}",
        "busca a María Gómez|buscar_clientes|\"María Gómez\"",
        "search Maria Gomez|buscar_clientes|\"Maria Gomez\"",
        "find the client Ana|buscar_clientes|\"the client Ana\"",
      })
  void aQuestionBecomesTheMatchingToolCall(String question, String tool, String expectedArg) {
    ToolCall call = requestedTool(ask(ChatTurn.user(question)));

    assertThat(call.name()).isEqualTo(tool);
    assertThat(call.argumentsJson()).contains(expectedArg.replace("{}", "{}"));
  }

  @Test
  void aQuestionAboutAClientsAppointmentsFirstSearchesTheClient_thenAsksForTheirAppointments() {
    ChatTurn question = ChatTurn.user("appointments of Maria Gomez on 2026-12-01");

    ToolCall first = requestedTool(ask(question));
    assertThat(first.name()).isEqualTo("buscar_clientes");
    assertThat(first.argumentsJson()).contains("Maria Gomez");

    List<ModelEvent> second =
        ask(
            question,
            ChatTurn.assistantToolCalls("", List.of(first)),
            ChatTurn.toolResults(
                List.of(
                    new ToolResult(
                        first.id(),
                        "buscar_clientes",
                        "{\"data\":{\"clients\":[{\"id\":42,\"fullName\":\"MARIA GOMEZ\"}]}}"))));
    ToolCall next = requestedTool(second);
    assertThat(next.name()).isEqualTo("turnos_del_dia");
    assertThat(next.argumentsJson()).contains("\"clientId\":42").contains("2026-12-01");
  }

  @Test
  void theDateAfterTheClientsNameIsNotPartOfTheName() {
    ToolCall call = requestedTool(ask(ChatTurn.user("appointments of Maria Gomez on 2026-11-21")));

    assertThat(call.name()).isEqualTo("buscar_clientes");
    assertThat(call.argumentsJson()).isEqualTo("{\"query\":\"Maria Gomez\"}");
  }

  @Test
  void aToolResultBecomesAPlainSummaryInSpanish() {
    ChatTurn question = ChatTurn.user("appointments 2026-12-01");
    ToolCall call = new ToolCall("c1", "turnos_del_dia", "{}");

    String answer =
        said(
            ask(
                question,
                ChatTurn.assistantToolCalls("", List.of(call)),
                ChatTurn.toolResults(
                    List.of(
                        new ToolResult(
                            "c1",
                            "turnos_del_dia",
                            "{\"data\":{\"date\":\"2026-12-01\",\"appointments\":[{\"start\":\"14:30\","
                                + "\"clientName\":\"MARIA\",\"serviceName\":\"Corte\","
                                + "\"professionalName\":\"Lucia\"}]}}")))));

    assertThat(answer)
        .contains("Hay 1 turno(s) para 2026-12-01")
        .contains("14:30 MARIA · Corte · Lucia");
  }

  @Test
  void anEmptyResultAndAnErrorResultAreAnsweredWithoutInventingData() {
    ToolCall call = new ToolCall("c1", "buscar_clientes", "{}");
    ChatTurn question = ChatTurn.user("search Nadie");
    ChatTurn calls = ChatTurn.assistantToolCalls("", List.of(call));

    String none =
        said(
            ask(
                question,
                calls,
                ChatTurn.toolResults(
                    List.of(
                        new ToolResult("c1", "buscar_clientes", "{\"data\":{\"clients\":[]}}")))));
    String failed =
        said(
            ask(
                question,
                calls,
                ChatTurn.toolResults(
                    List.of(
                        new ToolResult("c1", "buscar_clientes", "{\"error\":\"TOOL_FAILED\"}")))));

    assertThat(none).isEqualTo("No encontré clientes con ese nombre.");
    assertThat(failed).isEqualTo("No pude consultar ese dato.");
  }

  @Test
  void anythingElseGetsTheFallbackWithoutTools() {
    List<ModelEvent> events = ask(ChatTurn.user("hello there"));

    assertThat(events).noneMatch(ModelEvent.ToolCalls.class::isInstance);
    assertThat(said(events)).isEqualTo(ScriptedAssistantModelClient.FALLBACK);
  }

  @Test
  void theFailurePhraseMakesTheModelUnavailable() {
    assertThatThrownBy(() -> ask(ChatTurn.user("falla modelo")))
        .isInstanceOf(AssistantModelException.class);
    assertThatThrownBy(() -> ask(ChatTurn.user("the model fails now")))
        .isInstanceOf(AssistantModelException.class);
  }

  @Test
  void answersAreStreamedInSeveralChunks() {
    List<ModelEvent> events = ask(ChatTurn.user("hello there"));

    long chunks = events.stream().filter(ModelEvent.TextDelta.class::isInstance).count();
    assertThat(chunks).isGreaterThan(3);
    assertThat(events.get(events.size() - 1)).isInstanceOf(ModelEvent.Completed.class);
  }
}
