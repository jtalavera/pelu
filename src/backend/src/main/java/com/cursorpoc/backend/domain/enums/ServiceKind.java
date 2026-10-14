package com.cursorpoc.backend.domain.enums;

/**
 * Stock integration (HU-59): what a catalog item is. Only {@link #PRODUCT} items are synchronised
 * to control-stock and move stock when invoiced; {@link #SERVICE} items (haircuts, brushing…) never
 * do.
 */
public enum ServiceKind {
  SERVICE,
  PRODUCT
}
