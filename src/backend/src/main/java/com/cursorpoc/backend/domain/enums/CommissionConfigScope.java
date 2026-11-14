package com.cursorpoc.backend.domain.enums;

/** Módulo de comisiones: Calculation input with its own version timeline (HU-COM-01/02/09). */
public enum CommissionConfigScope {
  BASE,
  DEFAULT_SERVICE,
  DEFAULT_PRODUCT,
  PERIODICITY,
  RULE,
  /** HU-COM-12: regla por grupo de comisión (con o sin profesional). */
  GROUP_RULE,
  /** HU-COM-12: destino por defecto del monto fijo (PROFESSIONAL / SALON). */
  FIXED_DESTINATION,
  /** HU-COM-12: el salón retiene para aguinaldo (true / false). */
  AGUINALDO_ENABLED,
  /** HU-COM-12: % de retención por defecto. */
  AGUINALDO_DEFAULT,
  /** HU-COM-12: % de retención de una profesional (precarga sus reglas). */
  RETENTION_PROFILE
}
