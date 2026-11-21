package com.cursorpoc.backend.assistant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.assistant.AssistantModelClient.ChatTurn;
import com.cursorpoc.backend.assistant.AssistantModelClient.ModelEvent;
import com.cursorpoc.backend.assistant.AssistantModelClient.ModelRequest;
import com.cursorpoc.backend.assistant.AssistantModelClient.ToolCall;
import com.cursorpoc.backend.assistant.AssistantModelClient.ToolResult;
import com.cursorpoc.backend.assistant.AssistantModelClient.ToolSpec;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.model.tool.ToolCallingChatOptions;
import reactor.core.publisher.Flux;

/**
 * The real model client against a stub {@link ChatModel}: how our request maps to a Spring AI
 * prompt, and how streamed text / fragmented tool calls come back. (The call to Foundry itself can
 * only be verified against a real deployment.)
 */
class FoundryAssistantModelClientTest {

  private static final ToolSpec TOOL =
      new ToolSpec("buscar_clientes", "Busca", "{\"type\":\"object\",\"properties\":{}}");

  private static ChatResponse chunk(String text, AssistantMessage.ToolCall... calls) {
    return new ChatResponse(
        List.of(
            new Generation(
                AssistantMessage.builder().content(text).toolCalls(List.of(calls)).build())));
  }

  private static FoundryAssistantModelClient client(ChatModel model) {
    return new FoundryAssistantModelClient(() -> model, 1000);
  }

  private static List<ModelEvent> run(FoundryAssistantModelClient c, ModelRequest r) {
    List<ModelEvent> events = new ArrayList<>();
    c.streamTurn(r, events::add);
    return events;
  }

  private static ModelRequest request(ChatTurn... turns) {
    return new ModelRequest("sistema", List.of(turns), List.of(TOOL));
  }

  @Test
  void streamedText_becomesDeltasInOrder_thenCompleted() {
    ChatModel model = mock(ChatModel.class);
    when(model.stream(any(Prompt.class))).thenReturn(Flux.just(chunk("Hola "), chunk("Maria")));

    List<ModelEvent> events = run(client(model), request(ChatTurn.user("hola")));

    assertThat(events.get(0)).isEqualTo(new ModelEvent.TextDelta("Hola "));
    assertThat(events.get(1)).isEqualTo(new ModelEvent.TextDelta("Maria"));
    assertThat(events.get(events.size() - 1)).isInstanceOf(ModelEvent.Completed.class);
  }

  @Test
  void aWholeToolCall_isSurfacedAsOneToolCallsEvent() {
    ChatModel model = mock(ChatModel.class);
    when(model.stream(any(Prompt.class)))
        .thenReturn(
            Flux.just(
                chunk(
                    "",
                    new AssistantMessage.ToolCall(
                        "call_1", "function", "buscar_clientes", "{\"query\":\"ana\"}"))));

    List<ModelEvent> events = run(client(model), request(ChatTurn.user("busca ana")));

    assertThat(events)
        .anySatisfy(
            e ->
                assertThat(e)
                    .isEqualTo(
                        new ModelEvent.ToolCalls(
                            List.of(
                                new ToolCall(
                                    "call_1", "buscar_clientes", "{\"query\":\"ana\"}")))));
  }

  @Test
  void aFragmentedToolCall_isReassembled() {
    Map<String, ToolCall> calls = new LinkedHashMap<>();
    String key =
        FoundryAssistantModelClient.mergeToolCall(
            calls,
            null,
            new AssistantMessage.ToolCall("call_1", "function", "turnos_del_dia", "{\"da"));
    key =
        FoundryAssistantModelClient.mergeToolCall(
            calls, key, new AssistantMessage.ToolCall("", "function", "", "te\":\"hoy\"}"));

    assertThat(calls).hasSize(1);
    assertThat(calls.get("call_1"))
        .isEqualTo(new ToolCall("call_1", "turnos_del_dia", "{\"date\":\"hoy\"}"));
  }

  @Test
  void aRepeatedWholeCall_replacesInsteadOfDuplicatingTheArguments() {
    Map<String, ToolCall> calls = new LinkedHashMap<>();
    String key =
        FoundryAssistantModelClient.mergeToolCall(
            calls, null, new AssistantMessage.ToolCall("c1", "function", "listar_servicios", "{}"));
    FoundryAssistantModelClient.mergeToolCall(
        calls, key, new AssistantMessage.ToolCall("c1", "function", "listar_servicios", "{}"));

    assertThat(calls.get("c1").argumentsJson()).isEqualTo("{}");
  }

  @Test
  void toolsAreDeclaredToTheModel_andNeverExecutedByTheLibrary() {
    FoundryAssistantModelClient c = client(mock(ChatModel.class));

    Prompt prompt =
        c.toPrompt(
            request(
                ChatTurn.user("busca ana"),
                ChatTurn.assistantToolCalls(
                    "", List.of(new ToolCall("c1", "buscar_clientes", "{\"query\":\"ana\"}"))),
                ChatTurn.toolResults(
                    List.of(new ToolResult("c1", "buscar_clientes", "{\"data\":{}}")))));

    assertThat(prompt.getInstructions()).hasSize(4); // system + user + assistant + tool result
    ToolCallingChatOptions options = (ToolCallingChatOptions) prompt.getOptions();
    assertThat(options.getToolCallbacks()).hasSize(1);
    var callback = options.getToolCallbacks().get(0);
    assertThat(callback.getToolDefinition().name()).isEqualTo("buscar_clientes");
    assertThatThrownBy(() -> callback.call("{}")).isInstanceOf(UnsupportedOperationException.class);
  }

  @Test
  void aFailingModelCall_isAnAssistantModelException() {
    ChatModel model = mock(ChatModel.class);
    when(model.stream(any(Prompt.class))).thenReturn(Flux.error(new IllegalStateException("429")));

    assertThatThrownBy(() -> run(client(model), request(ChatTurn.user("hola"))))
        .isInstanceOf(AssistantModelException.class);
  }

  @Test
  void aMissingConfiguration_isAnAssistantModelException_notAStartupFailure() {
    FoundryAssistantModelClient c =
        new FoundryAssistantModelClient(
            () -> FoundryClientConfig.buildChatModel(new AssistantProperties()), 1000);

    assertThatThrownBy(() -> run(c, request(ChatTurn.user("hola"))))
        .isInstanceOf(AssistantModelException.class);
  }

  @Test
  void theRealChatModel_canBeBuiltWithEntraIdAndNoApiKey() {
    AssistantProperties props = new AssistantProperties();
    props.setEndpoint("https://femme-foundry-test.cognitiveservices.azure.com/");
    props.setDeployment("femme-assistant");

    // No token is requested until the first call, so this works offline and proves the wiring.
    assertThat(FoundryClientConfig.buildChatModel(props)).isNotNull();
  }
}
