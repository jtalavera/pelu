package com.cursorpoc.backend.service;

import com.azure.messaging.servicebus.ServiceBusProcessorClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.SmartLifecycle;
import org.springframework.stereotype.Component;

/**
 * RT-20 (Hardening_SIFEN.md): starts the Service Bus consumer once the application context is fully
 * up, and stops it on shutdown — so a Container Apps SIGTERM lets in-flight messages
 * complete/settle instead of the process dying mid-processing and leaking a lock until it expires.
 * Constructing a {@link ServiceBusProcessorClient} does not start it on its own; this is that
 * missing wiring.
 */
@Component
@ConditionalOnProperty(
    name = "app.femme.servicebus.enabled",
    havingValue = "true",
    matchIfMissing = true)
public class ServiceBusProcessorLifecycle implements SmartLifecycle {

  private static final Logger log = LoggerFactory.getLogger(ServiceBusProcessorLifecycle.class);

  private final ServiceBusProcessorClient processorClient;

  public ServiceBusProcessorLifecycle(ServiceBusProcessorClient processorClient) {
    this.processorClient = processorClient;
  }

  @Override
  public void start() {
    log.info("Starting SIFEN submission queue processor");
    processorClient.start();
  }

  @Override
  public void stop() {
    log.info("Stopping SIFEN submission queue processor");
    processorClient.stop();
  }

  @Override
  public boolean isRunning() {
    return processorClient.isRunning();
  }
}
