package com.cursorpoc.backend.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;

/** HU-WAP-02: the approval status of a template as last reported by Meta. */
@Entity
@Table(
    name = "whatsapp_template_status",
    uniqueConstraints = @UniqueConstraint(columnNames = {"template_name", "language"}))
public class WhatsAppTemplateStatus {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "template_name", nullable = false, length = 64)
  private String templateName;

  @Column(nullable = false, length = 8)
  private String language;

  /** APPROVED | PENDING | REJECTED | PAUSED | DISABLED | UNKNOWN */
  @Column(nullable = false, length = 16)
  private String status;

  @Column(length = 32)
  private String category;

  @Column(length = 500)
  private String reason;

  @Column(name = "checked_at", nullable = false)
  private Instant checkedAt;

  @Column(name = "changed_at", nullable = false)
  private Instant changedAt;

  public Long getId() {
    return id;
  }

  public String getTemplateName() {
    return templateName;
  }

  public void setTemplateName(String templateName) {
    this.templateName = templateName;
  }

  public String getLanguage() {
    return language;
  }

  public void setLanguage(String language) {
    this.language = language;
  }

  public String getStatus() {
    return status;
  }

  public void setStatus(String status) {
    this.status = status;
  }

  public String getCategory() {
    return category;
  }

  public void setCategory(String category) {
    this.category = category;
  }

  public String getReason() {
    return reason;
  }

  public void setReason(String reason) {
    this.reason = reason;
  }

  public Instant getCheckedAt() {
    return checkedAt;
  }

  public void setCheckedAt(Instant checkedAt) {
    this.checkedAt = checkedAt;
  }

  public Instant getChangedAt() {
    return changedAt;
  }

  public void setChangedAt(Instant changedAt) {
    this.changedAt = changedAt;
  }
}
