package com.cursorpoc.backend.config;

import com.azure.identity.DefaultAzureCredentialBuilder;
import com.azure.messaging.servicebus.ServiceBusClientBuilder;
import com.azure.messaging.servicebus.ServiceBusErrorContext;
import com.azure.messaging.servicebus.ServiceBusProcessorClient;
import com.azure.messaging.servicebus.ServiceBusSenderClient;
import com.azure.messaging.servicebus.models.ServiceBusReceiveMode;
import com.cursorpoc.backend.service.ServiceBusSifenMessageHandler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * RT-20 (Hardening_SIFEN.md): the Service Bus sender (used by {@code
 * ServiceBusSifenSubmissionQueue}) and processor (consumed by {@code SifenSubmissionQueueListener}
 * via {@code ServiceBusSifenMessageHandler}) clients — both authenticate via {@link
 * com.azure.identity.DefaultAzureCredential} (Managed Identity in Azure), same pattern as {@link
 * KeyVaultConfiguration}. Only present outside the {@code e2e}/{@code test} profiles (RT-08),
 * selected by {@code app.femme.servicebus.enabled}.
 *
 * <p>The processor client is built here but not started — {@code ServiceBusProcessorLifecycle} (a
 * {@link org.springframework.context.SmartLifecycle}) starts it once the application context is up
 * and stops it on shutdown, so a Container Apps SIGTERM drains in-flight messages instead of
 * dropping them mid-processing.
 */
@Configuration
@ConditionalOnProperty(
    name = "app.femme.servicebus.enabled",
    havingValue = "true",
    matchIfMissing = true)
public class ServiceBusConfiguration {

  private static final Logger log = LoggerFactory.getLogger(ServiceBusConfiguration.class);

  @Bean(destroyMethod = "close")
  public ServiceBusSenderClient serviceBusSenderClient(
      @Value("${app.femme.servicebus.namespace}") String namespace,
      @Value("${app.femme.servicebus.queue}") String queue) {
    return new ServiceBusClientBuilder()
        .fullyQualifiedNamespace(namespace)
        .credential(new DefaultAzureCredentialBuilder().build())
        .sender()
        .queueName(queue)
        .buildClient();
  }

  @Bean
  public ServiceBusProcessorClient serviceBusProcessorClient(
      @Value("${app.femme.servicebus.namespace}") String namespace,
      @Value("${app.femme.servicebus.queue}") String queue,
      ServiceBusSifenMessageHandler handler) {
    return new ServiceBusClientBuilder()
        .fullyQualifiedNamespace(namespace)
        .credential(new DefaultAzureCredentialBuilder().build())
        .processor()
        .queueName(queue)
        // Basic tier has no sessions (RT-20) — PeekLock only guarantees one consumer per
        // message, which is why the real multi-instance safety comes from the DB lease
        // (SifenInvoiceSubmissionPersistenceService#claimForSubmission), not from this alone.
        .receiveMode(ServiceBusReceiveMode.PEEK_LOCK)
        .disableAutoComplete()
        // 0.25 vCPU — do not raise. One message at a time, no prefetch buffering.
        .maxConcurrentCalls(1)
        .prefetchCount(0)
        .processMessage(handler::handle)
        .processError(this::logProcessingError)
        .buildProcessorClient();
  }

  private void logProcessingError(ServiceBusErrorContext context) {
    log.error(
        "SIFEN submission queue processor error source={} namespace={} entity={} error={}",
        context.getErrorSource(),
        context.getFullyQualifiedNamespace(),
        context.getEntityPath(),
        context.getException().toString());
  }
}
