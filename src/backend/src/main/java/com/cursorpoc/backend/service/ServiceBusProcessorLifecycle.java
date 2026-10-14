package com.cursorpoc.backend.service;

import com.azure.messaging.servicebus.ServiceBusProcessorClient;
import java.util.List;
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

  private final List<ServiceBusProcessorClient> processorClients;

  /**
   * Every processor client in the context: the SIFEN submission queue and, since HU-60, the {@code
   * stock-integration} queue.
   */
  public ServiceBusProcessorLifecycle(List<ServiceBusProcessorClient> processorClients) {
    this.processorClients = processorClients;
  }

  @Override
  public void start() {
    for (ServiceBusProcessorClient client : processorClients) {
      log.info("Starting Service Bus queue processor entity={}", client.getQueueName());
      client.start();
    }
  }

  @Override
  public void stop() {
    for (ServiceBusProcessorClient client : processorClients) {
      log.info("Stopping Service Bus queue processor entity={}", client.getQueueName());
      client.stop();
    }
  }

  @Override
  public boolean isRunning() {
    return !processorClients.isEmpty()
        && processorClients.stream().allMatch(ServiceBusProcessorClient::isRunning);
  }
}
