package com.cursorpoc.backend.assistant;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.SystemMessage;
import org.springframework.ai.chat.messages.ToolResponseMessage;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.ai.tool.definition.ToolDefinition;

/**
 * Real model: Spring AI's OpenAI chat model pointed at the Azure AI Foundry deployment. Spring AI
 * is only the transport — internal tool execution is never invoked by the library, so a tool
 * request comes back to the orchestrator as a {@link ModelEvent.ToolCalls} instead of being run by
 * the library.
 *
 * <p>The {@link ChatModel} is built lazily on first use so that an environment without Foundry
 * configured (local {@code bootRun}) still starts; the assistant then answers {@code
 * ASSISTANT_MODEL_UNAVAILABLE}.
 */
public class FoundryAssistantModelClient implements AssistantModelClient {

  private static final Logger log = LoggerFactory.getLogger(FoundryAssistantModelClient.class);

  private final Supplier<ChatModel> chatModelSupplier;
  private final String deployment;
  private final int maxCompletionTokens;
  private volatile ChatModel chatModel;

  /**
   * @param deployment name of the Foundry deployment; sent as the model of EVERY request, because
   *     per-request options otherwise fall back to Spring AI's default model name (a deployment
   *     that does not exist: 404)
   */
  public FoundryAssistantModelClient(
      Supplier<ChatModel> chatModelSupplier, String deployment, int maxCompletionTokens) {
    this.chatModelSupplier = chatModelSupplier;
    this.deployment = deployment;
    this.maxCompletionTokens = maxCompletionTokens;
  }

  @Override
  public void streamTurn(ModelRequest request, Consumer<ModelEvent> sink) {
    ChatModel model = chatModel();
    Prompt prompt = toPrompt(request);

    Map<String, ToolCall> toolCalls = new LinkedHashMap<>();
    String lastCallKey = null;
    Usage usage = Usage.NONE;
    try {
      List<ChatResponse> chunks = model.stream(prompt).toStream().toList();
      for (ChatResponse chunk : chunks) {
        for (Generation generation : chunk.getResults()) {
          AssistantMessage out = generation.getOutput();
          if (out.getText() != null && !out.getText().isEmpty()) {
            sink.accept(new ModelEvent.TextDelta(out.getText()));
          }
          for (AssistantMessage.ToolCall tc : out.getToolCalls()) {
            lastCallKey = mergeToolCall(toolCalls, lastCallKey, tc);
          }
        }
        if (chunk.getMetadata() != null && chunk.getMetadata().getUsage() != null) {
          var u = chunk.getMetadata().getUsage();
          int p = u.getPromptTokens() == null ? 0 : u.getPromptTokens();
          int c = u.getCompletionTokens() == null ? 0 : u.getCompletionTokens();
          if (p > 0 || c > 0) {
            usage = new Usage(p, c);
          }
        }
      }
    } catch (RuntimeException e) {
      throw new AssistantModelException("model call failed", e);
    }
    if (!toolCalls.isEmpty()) {
      sink.accept(new ModelEvent.ToolCalls(new ArrayList<>(toolCalls.values())));
    }
    sink.accept(new ModelEvent.Completed(usage));
  }

  /**
   * A streamed tool call may arrive whole or in fragments: a fragment with an id starts/updates
   * that call; one without an id continues the previous call's arguments.
   */
  static String mergeToolCall(
      Map<String, ToolCall> calls, String lastKey, AssistantMessage.ToolCall tc) {
    boolean hasId = tc.id() != null && !tc.id().isBlank();
    String key = hasId ? tc.id() : lastKey;
    if (key == null) {
      key = "call_" + calls.size();
    }
    ToolCall existing = calls.get(key);
    String name = tc.name() == null || tc.name().isBlank() ? null : tc.name();
    String args = tc.arguments() == null ? "" : tc.arguments();
    if (existing == null) {
      calls.put(key, new ToolCall(key, name == null ? "" : name, args));
    } else {
      boolean replacesWhole =
          hasId && !args.isEmpty() && args.startsWith("{") && args.endsWith("}");
      calls.put(
          key,
          new ToolCall(
              key,
              name != null ? name : existing.name(),
              replacesWhole ? args : existing.argumentsJson() + args));
    }
    return key;
  }

  Prompt toPrompt(ModelRequest request) {
    List<Message> messages = new ArrayList<>();
    messages.add(new SystemMessage(request.systemPrompt()));
    for (ChatTurn turn : request.turns()) {
      switch (turn.kind()) {
        case USER -> messages.add(new UserMessage(turn.text()));
        case ASSISTANT ->
            messages.add(
                AssistantMessage.builder()
                    .content(turn.text())
                    .toolCalls(
                        turn.toolCalls().stream()
                            .map(
                                c ->
                                    new AssistantMessage.ToolCall(
                                        c.id(), "function", c.name(), c.argumentsJson()))
                            .toList())
                    .build());
        case TOOL_RESULTS ->
            messages.add(
                ToolResponseMessage.builder()
                    .responses(
                        turn.toolResults().stream()
                            .map(
                                r ->
                                    new ToolResponseMessage.ToolResponse(
                                        r.callId(), r.name(), r.content()))
                            .toList())
                    .build());
      }
    }
    List<ToolCallback> callbacks =
        request.tools().stream().<ToolCallback>map(FoundryAssistantModelClient::declare).toList();
    // OpenAiChatOptions, not the generic ToolCallingChatOptions: OpenAiChatModel casts to it.
    // max_completion_tokens (not max_tokens, which gpt-5 models reject); streamUsage reports
    // tokens.
    OpenAiChatOptions options =
        OpenAiChatOptions.builder()
            .model(deployment)
            .deploymentName(deployment)
            .toolCallbacks(callbacks)
            .maxCompletionTokens(maxCompletionTokens)
            .streamUsage(true)
            .build();
    return new Prompt(messages, options);
  }

  /** A tool the model can see but the library must never run: the orchestrator executes it. */
  private static ToolCallback declare(ToolSpec spec) {
    ToolDefinition definition =
        ToolDefinition.builder()
            .name(spec.name())
            .description(spec.description())
            .inputSchema(spec.parametersSchema())
            .build();
    return new ToolCallback() {
      @Override
      public ToolDefinition getToolDefinition() {
        return definition;
      }

      @Override
      public String call(String toolInput) {
        throw new UnsupportedOperationException("tools are executed by AssistantOrchestrator");
      }
    };
  }

  private ChatModel chatModel() {
    ChatModel local = chatModel;
    if (local == null) {
      synchronized (this) {
        local = chatModel;
        if (local == null) {
          try {
            local = chatModelSupplier.get();
          } catch (RuntimeException e) {
            log.error("Assistant model is not available: {}", e.getMessage());
            throw new AssistantModelException("model not configured", e);
          }
          chatModel = local;
        }
      }
    }
    return local;
  }
}
