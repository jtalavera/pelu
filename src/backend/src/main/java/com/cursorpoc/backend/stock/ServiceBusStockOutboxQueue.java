package com.cursorpoc.backend.stock;

import com.azure.messaging.servicebus.ServiceBusMessage;
import com.azure.messaging.servicebus.ServiceBusSenderClient;
import com.cursorpoc.backend.config.StockServiceBusConfiguration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

/**
 * Stock integration (HU-60): production {@link StockOutboxQueue} — the {@code stock-integration}
 * queue on the existing Service Bus namespace (Basic tier). A failed send is only logged: the event
 * is already in {@code stock_outbox}, and {@code StockOutboxReconciler} picks it up within a
 * minute.
 */
@Service
@ConditionalOnExpression(StockServiceBusConfiguration.ENABLED)
public class ServiceBusStockOutboxQueue implements StockOutboxQueue {

  private static final Logger log = LoggerFactory.getLogger(ServiceBusStockOutboxQueue.class);

  private final ServiceBusSenderClient senderClient;
  private final ObjectMapper objectMapper;

  public ServiceBusStockOutboxQueue(
      @Qualifier("stockServiceBusSenderClient") ServiceBusSenderClient senderClient,
      ObjectMapper objectMapper) {
    this.senderClient = senderClient;
    this.objectMapper = objectMapper;
  }

  @Override
  public void wake(long tenantId, String correlationId) {
    try {
      ServiceBusMessage message =
          new ServiceBusMessage(
              objectMapper.writeValueAsString(
                  new StockOutboxMessagePayload(tenantId, correlationId)));
      message.setCorrelationId(correlationId);
      senderClient.sendMessage(message);
      log.info("Stock outbox wake-up enqueued tenantId={}", tenantId);
    } catch (RuntimeException e) {
      log.error(
          "Stock outbox wake-up could not be sent tenantId={} error={} (reconciler will retry)",
          tenantId,
          e.toString());
    }
  }
}
