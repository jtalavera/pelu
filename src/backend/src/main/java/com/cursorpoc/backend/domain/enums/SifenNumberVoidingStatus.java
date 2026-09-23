package com.cursorpoc.backend.domain.enums;

/**
 * RT-25 (Hardening_SIFEN.md): lifecycle of one "Inutilización de numeración" event ({@code
 * rGeVeInu}, Manual Técnico V150 sección 11.6.2). {@code PENDING} means recorded but never sent to
 * SIFEN yet — either an admin created it manually, or {@code SifenNumberVoidingService} recorded it
 * automatically when a rejected invoice's number was left unused (see that class's javadoc). The
 * three "terminal" values after PENDING mirror {@link SifenSubmissionStatus}'s own event-response
 * mapping.
 *
 * <p>Issue #175: {@code CANCELLED} means a pending auto-recorded voiding was called off because the
 * rejected invoice's number is being <b>corrected and resent under the same CDC</b> instead of
 * abandoned — so it will be reused after all and must not be reported to SIFEN as unused.
 */
public enum SifenNumberVoidingStatus {
  PENDING,
  APPROVED,
  APPROVED_WITH_OBSERVATION,
  REJECTED,
  CANCELLED
}
