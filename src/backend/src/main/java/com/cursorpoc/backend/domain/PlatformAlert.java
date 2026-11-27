package com.cursorpoc.backend.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * An alert for platform administrators (a paused template, an incomplete WhatsApp configuration).
 * Shown in the platform area until acknowledged; emailing platform admins arrives with HU-WAP-08.
 */
@Entity
@Table(name = "platform_alerts")
public class PlatformAlert {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(nullable = false, length = 48)
  private String category;

  @Column(nullable = false, length = 120)
  private String subject;

  @Column(length = 500)
  private String detail;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "acknowledged_at")
  private Instant acknowledgedAt;

  public Long getId() {
    return id;
  }

  public String getCategory() {
    return category;
  }

  public void setCategory(String category) {
    this.category = category;
  }

  public String getSubject() {
    return subject;
  }

  public void setSubject(String subject) {
    this.subject = subject;
  }

  public String getDetail() {
    return detail;
  }

  public void setDetail(String detail) {
    this.detail = detail;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }

  public void setCreatedAt(Instant createdAt) {
    this.createdAt = createdAt;
  }

  public Instant getAcknowledgedAt() {
    return acknowledgedAt;
  }

  public void setAcknowledgedAt(Instant acknowledgedAt) {
    this.acknowledgedAt = acknowledgedAt;
  }
}
