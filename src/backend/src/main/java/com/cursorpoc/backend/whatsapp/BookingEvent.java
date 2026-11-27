package com.cursorpoc.backend.whatsapp;

/**
 * HU-WAP-04 (criterio 1): the events of a booking that tell the client something, and the template
 * each one uses. The variable ORDER of each template is fixed by the Meta submission.
 */
public enum BookingEvent {
  /** The booking is confirmed (automatic confirmation, or the salon approved the request). */
  CONFIRMED(WhatsAppTemplate.TURNO_CONFIRMADO),
  /** The booking waits for the salon's approval. */
  PENDING(WhatsAppTemplate.TURNO_PENDIENTE),
  /**
   * The request was rejected or expired. The salon's free-text reason is NEVER sent (criterio 9).
   */
  REJECTED(WhatsAppTemplate.TURNO_NO_DISPONIBLE),
  /** The salon proposes another time. */
  PROPOSAL(WhatsAppTemplate.PROPUESTA_HORARIO),
  /** Cancelled, by the client or by the salon. */
  CANCELLED(WhatsAppTemplate.TURNO_CANCELADO);

  private final WhatsAppTemplate template;

  BookingEvent(WhatsAppTemplate template) {
    this.template = template;
  }

  public WhatsAppTemplate template() {
    return template;
  }
}
