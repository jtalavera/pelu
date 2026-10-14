package com.cursorpoc.backend.domain.enums;

/** Stock integration (HU-60..HU-64): kinds of event the outbox delivers to control-stock. */
public enum StockEventType {
  /** {@code PUT /tenants/{id}}: provisions or updates the tenant (name, status, currency). */
  TENANT_UPSERT,
  /** {@code PUT /tenants/{id}/feature-flags}: full resolved {@code STOCK_*} state + version. */
  FEATURE_FLAGS_SYNC,
  /** {@code items:bulk-upsert} with a single product. */
  CATALOG_UPSERT,
  /** {@code items:bulk-upsert} with every product of the tenant, in batches. */
  CATALOG_FULL_SYNC,
  /** {@code POST /documents} ({@code POST_SALE}) for an invoice's product lines. */
  SALE,
  /** {@code documents:reverse} for an invoice (void, SIFEN cancellation, correction). */
  REVERSE
}
