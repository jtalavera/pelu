package com.cursorpoc.backend.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/** An already-handled Meta notification, so a re-delivery is not processed twice. */
@Entity
@Table(name = "whatsapp_processed_events")
public class WhatsAppProcessedEvent {

  @Id
  @Column(name = "event_id", length = 200)
  private String eventId;

  @Column(name = "processed_at", nullable = false)
  private Instant processedAt;

  protected WhatsAppProcessedEvent() {}

  public WhatsAppProcessedEvent(String eventId, Instant processedAt) {
    this.eventId = eventId;
    this.processedAt = processedAt;
  }

  public String getEventId() {
    return eventId;
  }
}
