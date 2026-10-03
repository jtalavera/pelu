package com.cursorpoc.backend.stock;

/**
 * Stock integration (HU-60): the "wake-up" toward the outbox worker — same role Service Bus plays
 * for SIFEN (RT-20). The message only says "this tenant has pending events"; everything else is
 * read back from {@code stock_outbox}. Real deployments use {@link ServiceBusStockOutboxQueue};
 * tests and e2e use {@link LocalAsyncStockOutboxQueue}, selected by {@code
 * app.femme.servicebus.enabled}.
 */
public interface StockOutboxQueue {

  void wake(long tenantId, String correlationId);
}
