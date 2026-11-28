package com.cursorpoc.backend.whatsapp;

/**
 * The salon's own switch «Confirmaciones de reserva» (RSV-02, criterio 11), OFF by default. The
 * booking settings screen (A2) does not exist yet, so {@link PropertyBookingMessagingSettings}
 * answers from a platform property; A2 replaces that bean with the per-salon setting.
 */
public interface BookingMessagingSettings {

  /** Whether this salon wants booking notices sent over WhatsApp (otherwise they go by email). */
  boolean bookingNoticesEnabled(long tenantId);

  /**
   * The salon's switch «Recordatorios de turnos» (RSV-02, criterio 11), OFF by default: whether the
   * reminder of EVERY turno of the salon goes over WhatsApp (to clients who agreed) instead of
   * email.
   */
  boolean remindersEnabled(long tenantId);

  /**
   * The salon's switch «Respuestas por botón» (RSV-02, criterio 11), OFF by default: whether the
   * «Confirmo» / «No puedo ir» buttons go in the reminder and are attended when tapped (HU-WAP-06,
   * criterio 10). {@code BAJA} / {@code ALTA} are attended regardless.
   */
  boolean buttonRepliesEnabled(long tenantId);
}
