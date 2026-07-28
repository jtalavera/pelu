package com.cursorpoc.backend.domain.enums;

/**
 * SIFEN HU-06: the result SIFEN's synchronous reception service ({@code rEnviDe}) returns for a
 * submitted document, mapped from {@code dEstRes} ("Aprobado"/"Aprobado con observación"/
 * "Rechazado") — plus {@code PENDING_VERIFICATION} for when no response was received at all
 * (AC-05), which isn't one of SIFEN's own states.
 */
public enum SifenSubmissionStatus {
  PENDING_VERIFICATION,
  APPROVED,
  APPROVED_WITH_OBSERVATION,
  REJECTED
}
