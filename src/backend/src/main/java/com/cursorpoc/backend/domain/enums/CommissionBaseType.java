package com.cursorpoc.backend.domain.enums;

/**
 * Módulo de comisiones: Per-tenant calculation base (§4): line total after discounts, with or
 * without IVA.
 */
public enum CommissionBaseType {
  NET_OF_TAX,
  TAX_INCLUDED
}
