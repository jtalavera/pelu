package com.cursorpoc.backend.assistant;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.assistant.AssistantModelClient.ChatTurn;
import com.cursorpoc.backend.assistant.AssistantModelClient.ModelEvent;
import com.cursorpoc.backend.assistant.AssistantModelClient.ModelRequest;
import com.cursorpoc.backend.assistant.AssistantModelClient.ToolSpec;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/**
 * Opt-in smoke test against the REAL Azure AI Foundry deployment (Entra ID, via {@code az login}):
 * skipped unless {@code FEMME_AI_ENDPOINT} is set. Run it after applying the infrastructure:
 *
 * <pre>
 * FEMME_AI_ENDPOINT=https://femme-foundry-xxxx.cognitiveservices.azure.com/ \
 * FEMME_AI_DEPLOYMENT=femme-assistant ./gradlew test --tests '*FoundryLiveTest' --no-daemon -i
 * </pre>
 */
@EnabledIfEnvironmentVariable(named = "FEMME_AI_ENDPOINT", matches = ".+")
class FoundryLiveTest {

  private static final ToolSpec TOOL =
      new ToolSpec(
          "listar_servicios",
          "Lista los servicios activos del catálogo con precio y duración.",
          "{\"type\":\"object\",\"properties\":{},\"required\":[],\"additionalProperties\":false}");

  private static FoundryAssistantModelClient client() {
    AssistantProperties props = new AssistantProperties();
    props.setEndpoint(System.getenv("FEMME_AI_ENDPOINT"));
    props.setDeployment(System.getenv().getOrDefault("FEMME_AI_DEPLOYMENT", "femme-assistant"));
    return new FoundryAssistantModelClient(
        () -> FoundryClientConfig.buildChatModel(props),
        props.getDeployment(),
        props.getMaxCompletionTokens());
  }

  private static List<ModelEvent> run(ModelRequest request) {
    List<ModelEvent> events = new ArrayList<>();
    try {
      client().streamTurn(request, events::add);
    } catch (RuntimeException e) {
      // Print the whole cause chain: AssistantModelException hides it from the user on purpose.
      for (Throwable t = e; t != null; t = t.getCause()) {
        System.out.println("CAUSE> " + t.getClass().getName() + ": " + t.getMessage());
      }
      throw e;
    }
    return events;
  }

  @Test
  void plainQuestion_streamsTextFromTheRealModel() {
    List<ModelEvent> events =
        run(
            new ModelRequest(
                "Respondé en una palabra.", List.of(ChatTurn.user("Decí: ok")), List.of()));

    StringBuilder text = new StringBuilder();
    events.stream()
        .filter(ModelEvent.TextDelta.class::isInstance)
        .forEach(e -> text.append(((ModelEvent.TextDelta) e).text()));
    assertThat(text.toString()).isNotBlank();
    assertThat(events.get(events.size() - 1)).isInstanceOf(ModelEvent.Completed.class);
  }

  @Test
  void aQuestionAboutTheCatalog_makesTheModelRequestTheTool() {
    List<ModelEvent> events =
        run(
            new ModelRequest(
                "Sos el asistente de un salón. Usá las herramientas para consultar datos.",
                List.of(ChatTurn.user("¿Qué servicios tenemos?")),
                List.of(TOOL)));

    assertThat(events)
        .anySatisfy(
            e -> {
              assertThat(e).isInstanceOf(ModelEvent.ToolCalls.class);
              assertThat(((ModelEvent.ToolCalls) e).calls().get(0).name())
                  .isEqualTo("listar_servicios");
            });
  }
}
