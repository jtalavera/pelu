package com.cursorpoc.backend.stock;

import com.azure.messaging.servicebus.ServiceBusReceivedMessageContext;
import com.azure.messaging.servicebus.models.DeadLetterOptions;
import com.cursorpoc.backend.config.StockServiceBusConfiguration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

/**
 * Stock integration (HU-60): bridges a {@code stock-integration} Service Bus message to {@link
 * StockOutboxProcessor#processTenant}. The message is always completed once processed: retries live
 * in {@code stock_outbox.next_attempt_at} + {@code StockOutboxReconciler}, not in the queue.
 */
@Service
@ConditionalOnExpression(StockServiceBusConfiguration.ENABLED)
public class ServiceBusStockMessageHandler {

  private static final Logger log = LoggerFactory.getLogger(ServiceBusStockMessageHandler.class);

  private final StockOutboxProcessor processor;
  private final ObjectMapper objectMapper;

  public ServiceBusStockMessageHandler(StockOutboxProcessor processor, ObjectMapper objectMapper) {
    this.processor = processor;
    this.objectMapper = objectMapper;
  }

  public void handle(ServiceBusReceivedMessageContext context) {
    StockOutboxMessagePayload payload;
    try {
      payload =
          objectMapper.readValue(
              context.getMessage().getBody().toString(), StockOutboxMessagePayload.class);
    } catch (Exception e) {
      log.error("Stock outbox message could not be parsed, dead-lettering: {}", e.toString());
      context.deadLetter(new DeadLetterOptions().setDeadLetterReason("STOCK_MESSAGE_PARSE_ERROR"));
      return;
    }
    try {
      processor.processTenant(payload.tenantId(), payload.correlationId());
    } catch (RuntimeException e) {
      // The DB state is the truth; the reconciler re-wakes the tenant. Never redeliver from here.
      log.error(
          "Stock outbox processing failed tenantId={} error={}", payload.tenantId(), e.toString());
    }
    context.complete();
  }
}
