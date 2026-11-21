package com.cursorpoc.backend.assistant;

import com.cursorpoc.backend.assistant.AssistantModelClient.Usage;
import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.metrics.DoubleHistogram;
import io.opentelemetry.api.metrics.LongCounter;
import io.opentelemetry.api.metrics.Meter;
import org.springframework.stereotype.Component;

/**
 * Tokens, latency and tool usage of the assistant per tenant — the input to the cost decision
 * (plan_asistente.md, phase 1). Same OpenTelemetry route and cardinality rule as {@code
 * BusinessMetrics}: only {@code tenantId}, an outcome, a token kind and a tool name — never text.
 */
@Component
public class AssistantMetrics {

  static final String METER_NAME = "femme";

  static final AttributeKey<String> TENANT_ID = AttributeKey.stringKey("tenantId");
  static final AttributeKey<String> OUTCOME = AttributeKey.stringKey("outcome");
  static final AttributeKey<String> KIND = AttributeKey.stringKey("kind");
  static final AttributeKey<String> TOOL = AttributeKey.stringKey("tool");

  private final LongCounter requests;
  private final LongCounter tokens;
  private final LongCounter toolCalls;
  private final DoubleHistogram latency;

  public AssistantMetrics(OpenTelemetry openTelemetry) {
    Meter meter = openTelemetry.getMeter(METER_NAME);
    this.requests =
        meter
            .counterBuilder("femme.assistant.requests")
            .setDescription("Assistant answers by outcome (ok, error code, client_gone)")
            .build();
    this.tokens =
        meter
            .counterBuilder("femme.assistant.tokens")
            .setDescription("Model tokens used (kind = prompt | completion)")
            .build();
    this.toolCalls =
        meter
            .counterBuilder("femme.assistant.tool_calls")
            .setDescription("Tools run on behalf of the model")
            .build();
    this.latency =
        meter
            .histogramBuilder("femme.assistant.latency")
            .setUnit("ms")
            .setDescription("Whole answer latency, including model round trips and tools")
            .build();
  }

  public void recordRequest(long tenantId, String outcome, long latencyMs, Usage usage) {
    String tenant = Long.toString(tenantId);
    requests.add(1, Attributes.of(TENANT_ID, tenant, OUTCOME, outcome));
    latency.record(latencyMs, Attributes.of(TENANT_ID, tenant, OUTCOME, outcome));
    if (usage.promptTokens() > 0) {
      tokens.add(usage.promptTokens(), Attributes.of(TENANT_ID, tenant, KIND, "prompt"));
    }
    if (usage.completionTokens() > 0) {
      tokens.add(usage.completionTokens(), Attributes.of(TENANT_ID, tenant, KIND, "completion"));
    }
  }

  public void recordToolCall(long tenantId, String tool, String outcome) {
    toolCalls.add(
        1,
        Attributes.of(
            TENANT_ID,
            Long.toString(tenantId),
            TOOL,
            AssistantTools.isKnown(tool) ? tool : "unknown",
            OUTCOME,
            outcome));
  }
}
