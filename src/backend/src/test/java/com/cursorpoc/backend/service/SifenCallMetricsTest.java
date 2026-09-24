package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.cursorpoc.backend.config.SifenConnectionProperties;
import io.opentelemetry.api.common.Attributes;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** RT-21 (Hardening_SIFEN.md), ported to OpenTelemetry in issue #268. */
class SifenCallMetricsTest {

  private final InMemoryTelemetry telemetry = new InMemoryTelemetry();
  private final SifenCallMetrics metrics =
      new SifenCallMetrics(telemetry.openTelemetry(), new SifenConnectionProperties());

  @Test
  void record_tagsSuccess_whenTheCallReturnsAPresentOptional() {
    Optional<String> result = metrics.record("recepcion", 1L, () -> Optional.of("ok"));

    assertThat(result).contains("ok");
    assertThat(
            telemetry.histogramPoints(
                "sifen.operation", attributes("recepcion", "1", "success", "TEST")))
        .singleElement()
        .satisfies(p -> assertThat(p.getCount()).isEqualTo(1));
  }

  @Test
  void record_tagsNoResponse_whenTheCallReturnsAnEmptyOptional() {
    metrics.record("consulta", 2L, Optional::empty);

    assertThat(
            telemetry.histogramPoints(
                "sifen.operation", attributes("consulta", "2", "no_response", "TEST")))
        .hasSize(1);
  }

  @Test
  void record_tagsError_andStillPropagatesTheException_whenTheCallThrows() {
    assertThatThrownBy(
            () ->
                metrics.record(
                    "evento",
                    3L,
                    () -> {
                      throw new IllegalStateException("boom");
                    }))
        .isInstanceOf(IllegalStateException.class);

    assertThat(
            telemetry.histogramPoints(
                "sifen.operation", attributes("evento", "3", "error", "TEST")))
        .hasSize(1);
  }

  private static Attributes attributes(
      String operation, String tenantId, String outcome, String environment) {
    return Attributes.of(
        SifenCallMetrics.OPERATION,
        operation,
        SifenCallMetrics.TENANT_ID,
        tenantId,
        SifenCallMetrics.OUTCOME,
        outcome,
        SifenCallMetrics.ENVIRONMENT,
        environment);
  }
}
