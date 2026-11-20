package com.cursorpoc.backend.domain.enums;

/** Módulo de comisiones: Where the applied percent came from. */
public enum CommissionRuleOrigin {
  BENEFICIARY_ITEM,
  BENEFICIARY_GROUP,
  ITEM,
  GROUP,
  TENANT_DEFAULT_SERVICE,
  TENANT_DEFAULT_PRODUCT
}
