package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.SifenConnectionProperties;
import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.metrics.DoubleHistogram;
import java.util.Optional;
import java.util.function.Supplier;
import org.springframework.stereotype.Service;

/**
 * RT-21 (Hardening_SIFEN.md): wraps each SIFEN client's real (non-homologación) entry point with a
 * {@code sifen.operation} duration histogram (milliseconds), tagged {@code operation}
 * (recepcion/consulta/evento/lote/ consulta_lote), {@code tenantId}, {@code outcome}
 * (success/no_response/error), and {@code environment} (TEST/PRODUCTION) — exported to Application
 * Insights by the Java agent in real deployments (issue #268, see {@code OpenTelemetryConfig}).
 *
 * <p>{@code tenantId} as a tag is bounded by tenant count (tens), not unbounded — deliberately
 * never tag by {@code invoiceId} or any other high-cardinality value here.
 */
@Service
public class SifenCallMetrics {

  static final String METRIC_NAME = "sifen.operation";

  static final AttributeKey<String> OPERATION = AttributeKey.stringKey("operation");
  static final AttributeKey<String> TENANT_ID = AttributeKey.stringKey("tenantId");
  static final AttributeKey<String> OUTCOME = AttributeKey.stringKey("outcome");
  static final AttributeKey<String> ENVIRONMENT = AttributeKey.stringKey("environment");

  private static final double NANOS_PER_MILLI = 1_000_000.0;

  private final DoubleHistogram histogram;
  private final SifenConnectionProperties connectionProperties;

  public SifenCallMetrics(
      OpenTelemetry openTelemetry, SifenConnectionProperties connectionProperties) {
    this.histogram =
        openTelemetry
            .getMeter(BusinessMetrics.METER_NAME)
            .histogramBuilder(METRIC_NAME)
            .setUnit("ms")
            .setDescription("Duration and outcome of each real SIFEN web-service call")
            .build();
    this.connectionProperties = connectionProperties;
  }

  /**
   * Wraps a SIFEN client call that returns {@link Optional#empty()} for "no response" (every client
   * in this codebase follows that convention — see {@code SifenDocumentReceptionClient}'s javadoc)
   * and throws for a real configuration/programming error.
   */
  public <T> Optional<T> record(String operation, long tenantId, Supplier<Optional<T>> call) {
    long startNanos = System.nanoTime();
    String outcome = "error";
    try {
      Optional<T> result = call.get();
      outcome = result.isPresent() ? "success" : "no_response";
      return result;
    } finally {
      histogram.record(
          (System.nanoTime() - startNanos) / NANOS_PER_MILLI,
          Attributes.of(
              OPERATION,
              operation,
              TENANT_ID,
              String.valueOf(tenantId),
              OUTCOME,
              outcome,
              ENVIRONMENT,
              connectionProperties.activeEnvironment().name()));
    }
  }
}
