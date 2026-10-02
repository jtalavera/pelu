package com.cursorpoc.backend.stock;

/** Stock integration (HU-60): the Service Bus message body — "tenant X has pending events". */
public record StockOutboxMessagePayload(long tenantId, String correlationId) {}
