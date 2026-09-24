package com.cursorpoc.backend.service;

import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.sdk.OpenTelemetrySdk;
import io.opentelemetry.sdk.metrics.SdkMeterProvider;
import io.opentelemetry.sdk.metrics.data.HistogramPointData;
import io.opentelemetry.sdk.metrics.data.LongPointData;
import io.opentelemetry.sdk.metrics.data.MetricData;
import io.opentelemetry.sdk.testing.exporter.InMemoryMetricReader;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

/**
 * Issue #268: an in-memory OpenTelemetry SDK for asserting on the metrics {@link SifenCallMetrics}
 * / {@link BusinessMetrics} emit (the deployed app uses the Application Insights agent's SDK).
 */
final class InMemoryTelemetry {

  private final InMemoryMetricReader reader = InMemoryMetricReader.create();
  private final OpenTelemetry openTelemetry =
      OpenTelemetrySdk.builder()
          .setMeterProvider(SdkMeterProvider.builder().registerMetricReader(reader).build())
          .build();

  OpenTelemetry openTelemetry() {
    return openTelemetry;
  }

  /** Collects once — cumulative temporality, so each call sees every recording so far. */
  Collection<MetricData> collect() {
    return reader.collectAllMetrics();
  }

  /** Sum of the long counter {@code name} for exactly these attributes (0 when never recorded). */
  long counterValue(String name, Attributes attributes) {
    return find(name)
        .map(
            m ->
                m.getLongSumData().getPoints().stream()
                    .filter(p -> p.getAttributes().equals(attributes))
                    .mapToLong(LongPointData::getValue)
                    .sum())
        .orElse(0L);
  }

  /** Histogram points of {@code name} for exactly these attributes. */
  List<HistogramPointData> histogramPoints(String name, Attributes attributes) {
    return find(name)
        .map(
            m ->
                m.getHistogramData().getPoints().stream()
                    .filter(p -> p.getAttributes().equals(attributes))
                    .map(p -> (HistogramPointData) p)
                    .toList())
        .orElse(List.of());
  }

  /** Current value of the long gauge {@code name} for exactly these attributes, if reported. */
  Optional<Long> gaugeValue(String name, Attributes attributes) {
    return find(name)
        .flatMap(
            m ->
                m.getLongGaugeData().getPoints().stream()
                    .filter(p -> p.getAttributes().equals(attributes))
                    .map(LongPointData::getValue)
                    .findFirst());
  }

  private Optional<MetricData> find(String name) {
    return collect().stream().filter(m -> m.getName().equals(name)).findFirst();
  }
}
