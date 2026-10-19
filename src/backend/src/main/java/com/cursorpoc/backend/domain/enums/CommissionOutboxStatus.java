package com.cursorpoc.backend.domain.enums;

/** Módulo de comisiones: Processing state of an invoice event for commissions (HU-COM-04). */
public enum CommissionOutboxStatus {
  PENDING,
  DONE,
  FAILED
}
