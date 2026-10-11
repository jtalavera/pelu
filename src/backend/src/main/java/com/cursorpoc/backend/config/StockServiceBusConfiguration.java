package com.cursorpoc.backend.config;

import com.azure.identity.DefaultAzureCredentialBuilder;
import com.azure.messaging.servicebus.ServiceBusClientBuilder;
import com.azure.messaging.servicebus.ServiceBusErrorContext;
import com.azure.messaging.servicebus.ServiceBusProcessorClient;
import com.azure.messaging.servicebus.ServiceBusSenderClient;
import com.azure.messaging.servicebus.models.ServiceBusReceiveMode;
import com.cursorpoc.backend.stock.ServiceBusStockMessageHandler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Stock integration (HU-60): Service Bus clients for the {@code stock-integration} queue — same
 * namespace and Managed Identity as the SIFEN queue ({@link ServiceBusConfiguration}). Active only
 * when Service Bus is enabled <b>and</b> {@code app.femme.servicebus.stock-queue} names a queue
 * (Terraform sets {@code FEMME_SERVICEBUS_STOCK_QUEUE} once the queue exists); otherwise the outbox
 * is woken by {@code LocalAsyncStockOutboxQueue}, which — together with {@code
 * StockOutboxReconciler} and the outbox table — is just as reliable on a single replica.
 */
@Configuration
@ConditionalOnExpression(StockServiceBusConfiguration.ENABLED)
public class StockServiceBusConfiguration {

  public static final String ENABLED =
      "${app.femme.servicebus.enabled:true} and '${app.femme.servicebus.stock-queue:}' != ''";

  public static final String DISABLED =
      "!(${app.femme.servicebus.enabled:true}) or '${app.femme.servicebus.stock-queue:}' == ''";

  private static final Logger log = LoggerFactory.getLogger(StockServiceBusConfiguration.class);

  /**
   * Basic tier has no topics/sessions: per-tenant order is enforced by the outbox, not the queue.
   */
  @Bean(destroyMethod = "close")
  public ServiceBusSenderClient stockServiceBusSenderClient(
      @Value("${app.femme.servicebus.namespace}") String namespace,
      @Value("${app.femme.servicebus.stock-queue}") String queue) {
    return new ServiceBusClientBuilder()
        .fullyQualifiedNamespace(namespace)
        .credential(new DefaultAzureCredentialBuilder().build())
        .sender()
        .queueName(queue)
        .buildClient();
  }

  @Bean
  public ServiceBusProcessorClient stockServiceBusProcessorClient(
      @Value("${app.femme.servicebus.namespace}") String namespace,
      @Value("${app.femme.servicebus.stock-queue}") String queue,
      ServiceBusStockMessageHandler handler) {
    return new ServiceBusClientBuilder()
        .fullyQualifiedNamespace(namespace)
        .credential(new DefaultAzureCredentialBuilder().build())
        .processor()
        .queueName(queue)
        .receiveMode(ServiceBusReceiveMode.PEEK_LOCK)
        .disableAutoComplete()
        .maxConcurrentCalls(1)
        .prefetchCount(0)
        .processMessage(handler::handle)
        .processError(this::logProcessingError)
        .buildProcessorClient();
  }

  private void logProcessingError(ServiceBusErrorContext context) {
    log.error(
        "Stock outbox queue processor error source={} namespace={} entity={} error={}",
        context.getErrorSource(),
        context.getFullyQualifiedNamespace(),
        context.getEntityPath(),
        context.getException().toString());
  }
}
