package com.cursorpoc.backend.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** HU-WAP-07 criterio 4: a phone Meta reported as having no WhatsApp; not retried. */
@Entity
@Table(name = "whatsapp_unreachable")
public class WhatsAppUnreachable {

  @Id
  @Column(length = 32)
  private String phone;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "marked_at", nullable = false)
  private Instant markedAt;

  @Column(nullable = false, length = 64)
  private String reason;

  protected WhatsAppUnreachable() {}

  public WhatsAppUnreachable(String phone, Instant markedAt, String reason) {
    this.phone = phone;
    this.markedAt = markedAt;
    this.reason = reason;
  }

  public String getPhone() {
    return phone;
  }

  public Instant getMarkedAt() {
    return markedAt;
  }

  public String getReason() {
    return reason;
  }
}
