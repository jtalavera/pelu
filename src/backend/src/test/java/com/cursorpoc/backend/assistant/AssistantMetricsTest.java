package com.cursorpoc.backend.assistant;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.assistant.AssistantModelClient.Usage;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.sdk.OpenTelemetrySdk;
import io.opentelemetry.sdk.metrics.SdkMeterProvider;
import io.opentelemetry.sdk.metrics.data.HistogramPointData;
import io.opentelemetry.sdk.metrics.data.LongPointData;
import io.opentelemetry.sdk.metrics.data.MetricData;
import io.opentelemetry.sdk.testing.exporter.InMemoryMetricReader;
import org.junit.jupiter.api.Test;

class AssistantMetricsTest {

  private final InMemoryMetricReader reader = InMemoryMetricReader.create();
  private final AssistantMetrics metrics =
      new AssistantMetrics(
          OpenTelemetrySdk.builder()
              .setMeterProvider(SdkMeterProvider.builder().registerMetricReader(reader).build())
              .build());

  private long counter(String name, Attributes attrs) {
    return reader.collectAllMetrics().stream()
        .filter(m -> m.getName().equals(name))
        .flatMap(m -> m.getLongSumData().getPoints().stream())
        .filter(p -> p.getAttributes().equals(attrs))
        .mapToLong(LongPointData::getValue)
        .sum();
  }

  @Test
  void request_recordsOutcomeLatencyAndTokensPerTenant() {
    metrics.recordRequest(7L, "ok", 120, new Usage(100, 40));
    metrics.recordRequest(7L, "ASSISTANT_MODEL_UNAVAILABLE", 30, Usage.NONE);

    assertThat(
            counter(
                "femme.assistant.requests",
                Attributes.of(AssistantMetrics.TENANT_ID, "7", AssistantMetrics.OUTCOME, "ok")))
        .isEqualTo(1);
    assertThat(
            counter(
                "femme.assistant.tokens",
                Attributes.of(AssistantMetrics.TENANT_ID, "7", AssistantMetrics.KIND, "prompt")))
        .isEqualTo(100);
    assertThat(
            counter(
                "femme.assistant.tokens",
                Attributes.of(
                    AssistantMetrics.TENANT_ID, "7", AssistantMetrics.KIND, "completion")))
        .isEqualTo(40);
    MetricData latency =
        reader.collectAllMetrics().stream()
            .filter(m -> m.getName().equals("femme.assistant.latency"))
            .findFirst()
            .orElseThrow();
    assertThat(
            latency.getHistogramData().getPoints().stream()
                .mapToLong(HistogramPointData::getCount)
                .sum())
        .isEqualTo(2);
  }

  @Test
  void toolCalls_areTaggedByToolName_andUnknownNamesCollapse() {
    metrics.recordToolCall(7L, "turnos_del_dia", "ok");
    metrics.recordToolCall(7L, "inventada_por_el_modelo", "error");

    assertThat(
            counter(
                "femme.assistant.tool_calls",
                Attributes.of(
                    AssistantMetrics.TENANT_ID,
                    "7",
                    AssistantMetrics.TOOL,
                    "turnos_del_dia",
                    AssistantMetrics.OUTCOME,
                    "ok")))
        .isEqualTo(1);
    // A model-invented name must not become a new metric dimension value.
    assertThat(
            counter(
                "femme.assistant.tool_calls",
                Attributes.of(
                    AssistantMetrics.TENANT_ID,
                    "7",
                    AssistantMetrics.TOOL,
                    "unknown",
                    AssistantMetrics.OUTCOME,
                    "error")))
        .isEqualTo(1);
  }
}
