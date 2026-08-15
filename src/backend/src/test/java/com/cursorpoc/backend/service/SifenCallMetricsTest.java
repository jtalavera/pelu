package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.cursorpoc.backend.config.SifenConnectionProperties;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** RT-21 (Hardening_SIFEN.md). */
class SifenCallMetricsTest {

  @Test
  void record_tagsSuccess_whenTheCallReturnsAPresentOptional() {
    SimpleMeterRegistry registry = new SimpleMeterRegistry();
    SifenCallMetrics metrics = new SifenCallMetrics(registry, new SifenConnectionProperties());

    Optional<String> result = metrics.record("recepcion", 1L, () -> Optional.of("ok"));

    assertThat(result).contains("ok");
    assertThat(
            registry
                .find("sifen.operation")
                .tag("operation", "recepcion")
                .tag("tenantId", "1")
                .tag("outcome", "success")
                .tag("environment", "TEST")
                .timer())
        .isNotNull();
  }

  @Test
  void record_tagsNoResponse_whenTheCallReturnsAnEmptyOptional() {
    SimpleMeterRegistry registry = new SimpleMeterRegistry();
    SifenCallMetrics metrics = new SifenCallMetrics(registry, new SifenConnectionProperties());

    metrics.record("consulta", 2L, Optional::empty);

    assertThat(
            registry
                .find("sifen.operation")
                .tag("operation", "consulta")
                .tag("tenantId", "2")
                .tag("outcome", "no_response")
                .timer())
        .isNotNull();
  }

  @Test
  void record_tagsError_andStillPropagatesTheException_whenTheCallThrows() {
    SimpleMeterRegistry registry = new SimpleMeterRegistry();
    SifenCallMetrics metrics = new SifenCallMetrics(registry, new SifenConnectionProperties());

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
            registry
                .find("sifen.operation")
                .tag("operation", "evento")
                .tag("tenantId", "3")
                .tag("outcome", "error")
                .timer())
        .isNotNull();
  }
}
