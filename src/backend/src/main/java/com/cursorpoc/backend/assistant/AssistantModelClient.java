package com.cursorpoc.backend.assistant;

import java.util.List;
import java.util.function.Consumer;

/**
 * The language model behind the assistant. The tool loop is NOT delegated to the model library: the
 * orchestrator runs it, so the model only ever answers one turn — text and/or a request to call
 * tools — and tenant, role and result wrapping stay under our control. Two implementations: the
 * real Azure AI Foundry one ({@code app.femme.assistant.model=real}) and a scripted double ({@code
 * fake}, e2e/tests).
 */
public interface AssistantModelClient {

  /**
   * Runs ONE model turn, blocking the calling thread. Emits {@link ModelEvent.TextDelta}s as text
   * arrives, at most one {@link ModelEvent.ToolCalls} when the model wants tools run, and a final
   * {@link ModelEvent.Completed}.
   *
   * @throws AssistantModelException when the model cannot answer (maps to {@code
   *     ASSISTANT_MODEL_UNAVAILABLE})
   */
  void streamTurn(ModelRequest request, Consumer<ModelEvent> sink);

  record ModelRequest(String systemPrompt, List<ChatTurn> turns, List<ToolSpec> tools) {}

  /** A tool the model may call; {@code parametersSchema} is a JSON Schema object as a string. */
  record ToolSpec(String name, String description, String parametersSchema) {}

  record ToolCall(String id, String name, String argumentsJson) {}

  record ToolResult(String callId, String name, String content) {}

  record Usage(int promptTokens, int completionTokens) {
    public static final Usage NONE = new Usage(0, 0);

    public Usage plus(Usage other) {
      return new Usage(
          promptTokens + other.promptTokens, completionTokens + other.completionTokens);
    }
  }

  /**
   * One entry of the context: a user message, an assistant answer (optionally requesting tools), or
   * the results of the tools it requested.
   */
  record ChatTurn(Kind kind, String text, List<ToolCall> toolCalls, List<ToolResult> toolResults) {

    public enum Kind {
      USER,
      ASSISTANT,
      TOOL_RESULTS
    }

    public static ChatTurn user(String text) {
      return new ChatTurn(Kind.USER, text, List.of(), List.of());
    }

    public static ChatTurn assistant(String text) {
      return new ChatTurn(Kind.ASSISTANT, text, List.of(), List.of());
    }

    public static ChatTurn assistantToolCalls(String text, List<ToolCall> calls) {
      return new ChatTurn(Kind.ASSISTANT, text, List.copyOf(calls), List.of());
    }

    public static ChatTurn toolResults(List<ToolResult> results) {
      return new ChatTurn(Kind.TOOL_RESULTS, "", List.of(), List.copyOf(results));
    }
  }

  sealed interface ModelEvent {
    record TextDelta(String text) implements ModelEvent {}

    record ToolCalls(List<ToolCall> calls) implements ModelEvent {}

    record Completed(Usage usage) implements ModelEvent {}
  }
}
