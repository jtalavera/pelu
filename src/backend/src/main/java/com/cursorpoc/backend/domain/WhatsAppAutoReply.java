package com.cursorpoc.backend.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** When the fixed «this number only sends notices» text last went to a phone (HU-WAP-06). */
@Entity
@Table(name = "whatsapp_auto_replies")
public class WhatsAppAutoReply {

  @Id
  @Column(name = "phone", length = 32)
  private String phone;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "replied_at", nullable = false)
  private Instant repliedAt;

  protected WhatsAppAutoReply() {}

  public WhatsAppAutoReply(String phone, Instant repliedAt) {
    this.phone = phone;
    this.repliedAt = repliedAt;
  }

  public String getPhone() {
    return phone;
  }

  public Instant getRepliedAt() {
    return repliedAt;
  }

  public void setRepliedAt(Instant repliedAt) {
    this.repliedAt = repliedAt;
  }
}
