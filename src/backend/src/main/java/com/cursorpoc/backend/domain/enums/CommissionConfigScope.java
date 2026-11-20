package com.cursorpoc.backend.domain.enums;

/** Módulo de comisiones: Calculation input with its own version timeline (HU-COM-01/02/09). */
public enum CommissionConfigScope {
  BASE,
  DEFAULT_SERVICE,
  DEFAULT_PRODUCT,
  PERIODICITY,
  RULE,
  /** HU-COM-14: regla por grupo de comisión (con o sin profesional). */
  GROUP_RULE,
  /** HU-COM-14: destino por defecto del monto fijo (PROFESSIONAL / SALON). */
  FIXED_DESTINATION,
  /** HU-COM-14: el salón retiene para aguinaldo (true / false). */
  AGUINALDO_ENABLED,
  /** HU-COM-14: % de retención por defecto. */
  AGUINALDO_DEFAULT,
  /** HU-COM-14: % de retención de una profesional (precarga sus reglas). */
  RETENTION_PROFILE
}
