package com.cursorpoc.backend.domain.enums;

/**
 * Issue #205 AC-2: which SIFEN interaction a {@code SifenInvoiceEventLog} row records — mirrors the
 * three "single last result" concerns already tracked as scalar fields on {@link
 * com.cursorpoc.backend.domain.Invoice} (submission, cancellation, client identification).
 */
public enum SifenInvoiceEventType {
  SUBMISSION,
  CANCELLATION,
  CLIENT_IDENTIFICATION
}
