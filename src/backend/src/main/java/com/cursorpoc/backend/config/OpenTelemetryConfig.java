package com.cursorpoc.backend.config;

import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.OpenTelemetry;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Issue #268: exposes the process-wide {@link OpenTelemetry} instance as a bean so metric emitters
 * ({@code SifenCallMetrics}, {@code BusinessMetrics}) get it by constructor injection.
 *
 * <p>In deployed containers the Application Insights Java agent ({@code -javaagent}, see the
 * Dockerfile) installs its own OpenTelemetry SDK behind {@link GlobalOpenTelemetry}, so every
 * instrument created from this bean is exported to Application Insights ({@code customMetrics}).
 * Without the agent — unit tests, {@code bootRun}, the e2e profile — it resolves to a no-op.
 */
@Configuration
public class OpenTelemetryConfig {

  @Bean
  @ConditionalOnMissingBean
  public OpenTelemetry openTelemetry() {
    return GlobalOpenTelemetry.get();
  }
}
