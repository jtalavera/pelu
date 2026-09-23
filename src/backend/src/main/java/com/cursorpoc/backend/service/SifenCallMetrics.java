package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.SifenConnectionProperties;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.util.Optional;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.springframework.stereotype.Service;

/**
 * RT-21 (Hardening_SIFEN.md): wraps each SIFEN client's real (non-homologación) entry point with a
 * {@code sifen.operation} timer, tagged {@code operation} (recepcion/consulta/evento/lote/
 * consulta_lote), {@code tenantId}, {@code outcome} (success/no_response/error), and {@code
 * environment} (TEST/PRODUCTION) — exported wherever {@link MeterRegistry} publishes to
 * (Application Insights via {@code micrometer-registry-azure-monitor} in real deployments).
 *
 * <p>{@code tenantId} as a tag is bounded by tenant count (tens), not unbounded — deliberately
 * never tag by {@code invoiceId} or any other high-cardinality value here.
 */
@Service
public class SifenCallMetrics {

  private static final String METRIC_NAME = "sifen.operation";

  private final MeterRegistry meterRegistry;
  private final SifenConnectionProperties connectionProperties;

  public SifenCallMetrics(
      MeterRegistry meterRegistry, SifenConnectionProperties connectionProperties) {
    this.meterRegistry = meterRegistry;
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
      Timer.builder(METRIC_NAME)
          .tag("operation", operation)
          .tag("tenantId", String.valueOf(tenantId))
          .tag("outcome", outcome)
          .tag("environment", connectionProperties.activeEnvironment().name())
          .register(meterRegistry)
          .record(System.nanoTime() - startNanos, TimeUnit.NANOSECONDS);
    }
  }
}
