package com.cursorpoc.backend.stock;

import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * Stock integration (HU-62..HU-64): turns pelu's domain events into outbox events. Runs
 * synchronously in the publisher's transaction (plain {@code @EventListener}), which is what makes
 * the outbox row atomic with the invoice / void / catalog change.
 */
@Component
public class StockDomainEventListener {

  private final StockOutboxService outbox;

  public StockDomainEventListener(StockOutboxService outbox) {
    this.outbox = outbox;
  }

  @EventListener
  public void onInvoice(InvoiceStockEvent event) {
    switch (event.kind()) {
      case ISSUED -> outbox.enqueueSale(event.invoice());
      case VOIDED -> outbox.enqueueReverse(event.invoice(), event.reason());
      case CORRECTED -> {
        outbox.enqueueReverse(event.invoice(), "Comprobante corregido");
        outbox.enqueueSale(event.invoice());
      }
    }
  }

  @EventListener
  public void onCatalog(CatalogStockEvent event) {
    if (event.service() != null) {
      outbox.enqueueCatalogUpsert(event.service(), event.wasProduct());
    } else if (event.productsImported() > 0) {
      outbox.enqueueCatalogFullSync(event.tenantId(), false);
    }
  }
}
