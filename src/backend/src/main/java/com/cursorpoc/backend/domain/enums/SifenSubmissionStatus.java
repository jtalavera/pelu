package com.cursorpoc.backend.domain.enums;

/**
 * SIFEN HU-06: the result SIFEN's synchronous reception service ({@code rEnviDe}) returns for a
 * submitted document, mapped from {@code dEstRes} ("Aprobado"/"Aprobado con observación"/
 * "Rechazado") — plus {@code PENDING_VERIFICATION} for when no response was received at all
 * (AC-05), which isn't one of SIFEN's own states.
 *
 * <p>SIFEN HU-10: {@code CANCELLED} is set only once SIFEN itself approves a cancellation event
 * ({@code rGeVeCan}, AC-03) for an invoice previously {@code APPROVED}/{@code
 * APPROVED_WITH_OBSERVATION} — never assigned locally without a real SIFEN approval of the event.
 * If SIFEN rejects the cancellation instead (AC-04), the invoice's status is left untouched (never
 * set to this value), so this is a genuinely terminal, one-way transition.
 */
public enum SifenSubmissionStatus {
  PENDING_VERIFICATION,
  APPROVED,
  APPROVED_WITH_OBSERVATION,
  REJECTED,
  CANCELLED
}
