package com.cursorpoc.backend.stock;

import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.Tenant;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

class StockDomainEventListenerTest {

  private final StockOutboxService outbox = mock(StockOutboxService.class);
  private final StockDomainEventListener listener = new StockDomainEventListener(outbox);

  @Test
  void issuedVoidedAndCorrectedInvoicesMapToSaleReverseAndReversePlusSale() {
    Invoice invoice = new Invoice();
    listener.onInvoice(InvoiceStockEvent.issued(invoice));
    verify(outbox).enqueueSale(invoice);

    listener.onInvoice(InvoiceStockEvent.voided(invoice, "Error de carga"));
    verify(outbox).enqueueReverse(invoice, "Error de carga");

    Invoice corrected = new Invoice();
    listener.onInvoice(InvoiceStockEvent.corrected(corrected));
    InOrder order = inOrder(outbox);
    order.verify(outbox).enqueueReverse(corrected, "Comprobante corregido");
    order.verify(outbox).enqueueSale(corrected);
  }

  @Test
  void catalogChangesAndUploadsMapToUpsertAndOneFullSync() {
    Tenant tenant = new Tenant();
    tenant.setId(3L);
    SalonService product = new SalonService();
    product.setTenant(tenant);
    listener.onCatalog(CatalogStockEvent.itemChanged(product, true));
    verify(outbox).enqueueCatalogUpsert(product, true);

    listener.onCatalog(CatalogStockEvent.imported(3L, 12));
    verify(outbox).enqueueCatalogFullSync(3L, false);
  }

  @Test
  void anUploadWithoutProductsSyncsNothing() {
    listener.onCatalog(CatalogStockEvent.imported(3L, 0));
    verifyNoInteractions(outbox);
    verify(outbox, never()).enqueueCatalogFullSync(3L, false);
  }
}
