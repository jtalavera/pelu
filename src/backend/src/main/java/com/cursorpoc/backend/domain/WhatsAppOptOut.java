package com.cursorpoc.backend.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** HU-WAP-03: a phone that asked to stop receiving notices — applies to every salon. */
@Entity
@Table(name = "whatsapp_opt_outs")
public class WhatsAppOptOut {

  @Id
  @Column(length = 32)
  private String phone;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "opted_out_at", nullable = false)
  private Instant optedOutAt;

  @Column(nullable = false, length = 16)
  private String source;

  protected WhatsAppOptOut() {}

  public WhatsAppOptOut(String phone, Instant optedOutAt, String source) {
    this.phone = phone;
    this.optedOutAt = optedOutAt;
    this.source = source;
  }

  public String getPhone() {
    return phone;
  }

  public Instant getOptedOutAt() {
    return optedOutAt;
  }

  public String getSource() {
    return source;
  }
}
