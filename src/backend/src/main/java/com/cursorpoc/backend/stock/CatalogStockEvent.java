package com.cursorpoc.backend.stock;

import com.cursorpoc.backend.domain.SalonService;

/**
 * Stock integration (HU-62): a catalog item changed ({@code service != null}; {@code wasProduct}
 * tells whether it was a product before the change) or a platform upload finished for a tenant
 * ({@code service == null}, {@code productsImported} products were created) — published inside the
 * changing transaction.
 */
public record CatalogStockEvent(
    long tenantId, SalonService service, boolean wasProduct, int productsImported) {

  public static CatalogStockEvent itemChanged(SalonService service, boolean wasProduct) {
    return new CatalogStockEvent(service.getTenant().getId(), service, wasProduct, 0);
  }

  public static CatalogStockEvent imported(long tenantId, int productsImported) {
    return new CatalogStockEvent(tenantId, null, false, productsImported);
  }
}
