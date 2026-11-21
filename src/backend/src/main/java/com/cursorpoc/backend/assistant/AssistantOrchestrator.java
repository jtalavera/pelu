package com.cursorpoc.backend.assistant;

import com.cursorpoc.backend.assistant.AssistantEventSink.AssistantClientGoneException;
import com.cursorpoc.backend.assistant.AssistantModelClient.ChatTurn;
import com.cursorpoc.backend.assistant.AssistantModelClient.ModelEvent;
import com.cursorpoc.backend.assistant.AssistantModelClient.ModelRequest;
import com.cursorpoc.backend.assistant.AssistantModelClient.ToolCall;
import com.cursorpoc.backend.assistant.AssistantModelClient.ToolResult;
import com.cursorpoc.backend.assistant.AssistantModelClient.Usage;
import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.repository.TenantRepository;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.format.TextStyle;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

/**
 * Runs one user message end to end: persists it, asks the model, runs the tools it requests (our
 * own loop — the model library never executes anything), streams the answer as SSE events and
 * persists the result.
 *
 * <p>Principle of the whole feature: the model proposes, a person confirms. Phase 1 only has
 * read-only tools. The conversation text is never logged — only ids, tool names, token counts and
 * error codes.
 */
@Service
public class AssistantOrchestrator {

  private static final Logger log = LoggerFactory.getLogger(AssistantOrchestrator.class);

  static final String EVENT_DELTA = "message.delta";
  static final String EVENT_TOOL_STATUS = "tool.status";
  static final String EVENT_DONE = "message.done";
  static final String EVENT_ERROR = "error";

  private final AssistantModelClient model;
  private final AssistantTools tools;
  private final AssistantConversationService conversations;
  private final TenantRepository tenants;
  private final AssistantProperties properties;
  private final FemmeTimeProperties timeProperties;
  private final AssistantMetrics metrics;
  private final String promptTemplate;

  public AssistantOrchestrator(
      AssistantModelClient model,
      AssistantTools tools,
      AssistantConversationService conversations,
      TenantRepository tenants,
      AssistantProperties properties,
      FemmeTimeProperties timeProperties,
      AssistantMetrics metrics) {
    this.model = model;
    this.tools = tools;
    this.conversations = conversations;
    this.tenants = tenants;
    this.properties = properties;
    this.timeProperties = timeProperties;
    this.metrics = metrics;
    this.promptTemplate = loadPrompt();
  }

  /** Never throws: every failure is reported to the client as an {@code error} event. */
  public void run(
      AssistantContext ctx,
      long conversationId,
      String userText,
      String inputMode,
      AssistantEventSink sink) {
    long startedAt = System.nanoTime();
    Usage usage = Usage.NONE;
    String outcome = "ok";
    StringBuilder answer = new StringBuilder();
    try {
      conversations.appendUser(conversationId, userText, inputMode);
      List<ChatTurn> turns = new ArrayList<>(conversations.contextTurns(conversationId));
      String systemPrompt = systemPrompt(ctx);
      var toolSpecs = tools.specsFor(ctx);
      long deadline = startedAt + properties.getRequestTimeoutSeconds() * 1_000_000_000L;

      boolean finished = false;
      for (int round = 0; round < properties.getMaxToolIterations() && !finished; round++) {
        if (System.nanoTime() > deadline) {
          throw new AssistantModelException("request timed out");
        }
        TurnResult turn =
            runModelTurn(new ModelRequest(systemPrompt, turns, toolSpecs), sink, answer);
        usage = usage.plus(turn.usage());
        if (turn.toolCalls().isEmpty()) {
          finished = true;
        } else {
          turns.add(ChatTurn.assistantToolCalls(turn.text(), turn.toolCalls()));
          turns.add(ChatTurn.toolResults(runTools(ctx, conversationId, turn.toolCalls(), sink)));
        }
      }
      if (!finished) {
        outcome = "ASSISTANT_TOO_MANY_STEPS";
        sink.send(EVENT_ERROR, Map.of("code", outcome));
      } else if (answer.toString().isBlank()) {
        outcome = "ASSISTANT_MODEL_UNAVAILABLE";
        sink.send(EVENT_ERROR, Map.of("code", outcome));
      } else {
        AssistantMessage saved =
            conversations.appendAssistant(conversationId, answer.toString(), usage);
        sink.send(
            EVENT_DONE,
            Map.of(
                "messageId",
                saved.getId(),
                "usage",
                Map.of(
                    "promptTokens", usage.promptTokens(),
                    "completionTokens", usage.completionTokens())));
      }
    } catch (AssistantClientGoneException e) {
      outcome = "client_gone";
      if (!answer.toString().isBlank()) {
        conversations.appendAssistant(conversationId, answer.toString(), usage);
      }
    } catch (AssistantModelException e) {
      outcome = "ASSISTANT_MODEL_UNAVAILABLE";
      log.error(
          "assistant model unavailable tenantId={} conversationId={} cause={}",
          ctx.tenantId(),
          conversationId,
          rootCause(e));
      safeSend(sink, EVENT_ERROR, Map.of("code", outcome));
    } catch (RuntimeException e) {
      outcome = "ASSISTANT_INTERNAL_ERROR";
      log.error(
          "assistant failed tenantId={} conversationId={}", ctx.tenantId(), conversationId, e);
      safeSend(sink, EVENT_ERROR, Map.of("code", outcome));
    } finally {
      long ms = (System.nanoTime() - startedAt) / 1_000_000L;
      metrics.recordRequest(ctx.tenantId(), outcome, ms, usage);
      log.info(
          "assistant answer tenantId={} conversationId={} outcome={} promptTokens={}"
              + " completionTokens={} latencyMs={}",
          ctx.tenantId(),
          conversationId,
          outcome,
          usage.promptTokens(),
          usage.completionTokens(),
          ms);
    }
  }

  /**
   * One model round trip: relays text as it streams and collects tool requests and usage. Text goes
   * into {@code answer} as soon as the client has received it, so a disconnect keeps what was said.
   */
  private TurnResult runModelTurn(
      ModelRequest request, AssistantEventSink sink, StringBuilder answer) {
    StringBuilder text = new StringBuilder();
    List<ToolCall> calls = new ArrayList<>();
    Usage[] usage = {Usage.NONE};
    model.streamTurn(
        request,
        event -> {
          switch (event) {
            case ModelEvent.TextDelta d -> {
              sink.send(EVENT_DELTA, Map.of("text", d.text()));
              text.append(d.text());
              answer.append(d.text());
            }
            case ModelEvent.ToolCalls t -> calls.addAll(t.calls());
            case ModelEvent.Completed c -> usage[0] = c.usage();
          }
        });
    return new TurnResult(text.toString(), calls, usage[0]);
  }

  private List<ToolResult> runTools(
      AssistantContext ctx, long conversationId, List<ToolCall> calls, AssistantEventSink sink) {
    List<ToolResult> results = new ArrayList<>();
    for (ToolCall call : calls) {
      sink.send(EVENT_TOOL_STATUS, Map.of("tool", call.name(), "state", "running"));
      pauseForToolDelay();
      ToolOutcome outcome = tools.run(ctx, call.name(), call.argumentsJson());
      String result = outcome.json();
      boolean failed = result.startsWith("{\"error\"");
      metrics.recordToolCall(ctx.tenantId(), call.name(), failed ? "error" : "ok");
      conversations.appendTool(conversationId, call.name(), result);
      sink.send(EVENT_TOOL_STATUS, Map.of("tool", call.name(), "state", "done"));
      for (ToolOutcome.CardEvent card : outcome.cards()) {
        sink.send(card.event(), card.payload());
      }
      results.add(new ToolResult(call.id(), call.name(), result));
    }
    return results;
  }

  private void pauseForToolDelay() {
    int delay = properties.getToolDelayMs();
    if (delay <= 0) {
      return;
    }
    try {
      Thread.sleep(delay);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
  }

  String systemPrompt(AssistantContext ctx) {
    var zone = timeProperties.zoneId();
    LocalDate today = LocalDate.now(zone);
    String salon = tenants.findById(ctx.tenantId()).map(t -> t.getName()).orElse("el salón");
    return promptTemplate
        .replace("{{salonName}}", salon)
        .replace("{{userRole}}", ctx.isProfessional() ? "profesional" : "administración")
        .replace("{{today}}", today.toString())
        .replace(
            "{{weekday}}",
            today.getDayOfWeek().getDisplayName(TextStyle.FULL, Locale.forLanguageTag("es")))
        .replace(
            "{{currentPage}}", ctx.currentPage().isEmpty() ? "desconocida" : ctx.currentPage());
  }

  /**
   * Class and (truncated) message of the innermost cause — enough to tell a 404 deployment from a
   * 403 role from a timeout. Provider errors do not echo the prompt; the conversation text is never
   * logged.
   */
  static String rootCause(Throwable e) {
    Throwable root = e;
    while (root.getCause() != null && root.getCause() != root) {
      root = root.getCause();
    }
    String message = root.getMessage() == null ? "" : root.getMessage().replaceAll("\\s+", " ");
    return root.getClass().getSimpleName()
        + ": "
        + (message.length() > 300 ? message.substring(0, 300) + "…" : message);
  }

  private static void safeSend(AssistantEventSink sink, String event, Object payload) {
    try {
      sink.send(event, payload);
    } catch (AssistantClientGoneException ignored) {
      // Nobody left to tell.
    }
  }

  private static String loadPrompt() {
    try (var in = new ClassPathResource("assistant/system-prompt.md").getInputStream()) {
      return new String(in.readAllBytes(), StandardCharsets.UTF_8);
    } catch (IOException e) {
      throw new UncheckedIOException("assistant/system-prompt.md is missing", e);
    }
  }

  private record TurnResult(String text, List<ToolCall> toolCalls, Usage usage) {}
}
