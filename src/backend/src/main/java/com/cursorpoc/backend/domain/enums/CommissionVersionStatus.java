package com.cursorpoc.backend.domain.enums;

/**
 * Módulo de comisiones: Lifecycle of a configuration version; SCHEDULED is derived (ACTIVE with
 * effective_from in the future).
 */
public enum CommissionVersionStatus {
  ACTIVE,
  SUPERSEDED,
  CANCELLED
}
