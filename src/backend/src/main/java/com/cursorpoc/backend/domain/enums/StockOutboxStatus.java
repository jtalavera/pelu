package com.cursorpoc.backend.domain.enums;

/**
 * Stock integration (HU-60): lifecycle of an outbox event. {@code FAILED} blocks the tenant's queue
 * (later events wait so the sale-before-reversal order is kept) until a Platform Admin retries or
 * discards it (HU-67).
 */
public enum StockOutboxStatus {
  PENDING,
  PROCESSING,
  DONE,
  FAILED,
  DISCARDED
}
