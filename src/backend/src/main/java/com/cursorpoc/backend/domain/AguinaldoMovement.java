package com.cursorpoc.backend.domain;

import com.cursorpoc.backend.domain.enums.AguinaldoMovementKind;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * HU-COM-12: pago o ajuste manual del fondo de aguinaldo de una profesional. Lo retenido entra solo
 * desde las liquidaciones aprobadas; {@code amount} lleva signo (el pago resta).
 */
@Entity
@Table(name = "aguinaldo_movements")
public class AguinaldoMovement {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "tenant_id", nullable = false)
  private Long tenantId;

  @Column(name = "professional_id", nullable = false)
  private Long professionalId;

  @Enumerated(EnumType.STRING)
  @Column(name = "kind", nullable = false, length = 16)
  private AguinaldoMovementKind kind;

  @Column(name = "amount", nullable = false, precision = 19, scale = 2)
  private BigDecimal amount;

  @Column(name = "occurred_on", nullable = false)
  private LocalDate occurredOn;

  @Column(name = "payment_method", length = 32)
  private String paymentMethod;

  @Column(name = "closes_fund", nullable = false)
  private boolean closesFund;

  @Column(name = "note", length = 500)
  private String note;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "created_by_email", length = 320)
  private String createdByEmail;

  public Long getId() {
    return id;
  }

  public Long getTenantId() {
    return tenantId;
  }

  public void setTenantId(Long tenantId) {
    this.tenantId = tenantId;
  }

  public Long getProfessionalId() {
    return professionalId;
  }

  public void setProfessionalId(Long professionalId) {
    this.professionalId = professionalId;
  }

  public AguinaldoMovementKind getKind() {
    return kind;
  }

  public void setKind(AguinaldoMovementKind kind) {
    this.kind = kind;
  }

  public BigDecimal getAmount() {
    return amount;
  }

  public void setAmount(BigDecimal amount) {
    this.amount = amount;
  }

  public LocalDate getOccurredOn() {
    return occurredOn;
  }

  public void setOccurredOn(LocalDate occurredOn) {
    this.occurredOn = occurredOn;
  }

  public String getPaymentMethod() {
    return paymentMethod;
  }

  public void setPaymentMethod(String paymentMethod) {
    this.paymentMethod = paymentMethod;
  }

  public boolean isClosesFund() {
    return closesFund;
  }

  public void setClosesFund(boolean closesFund) {
    this.closesFund = closesFund;
  }

  public String getNote() {
    return note;
  }

  public void setNote(String note) {
    this.note = note;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }

  public void setCreatedAt(Instant createdAt) {
    this.createdAt = createdAt;
  }

  public String getCreatedByEmail() {
    return createdByEmail;
  }

  public void setCreatedByEmail(String createdByEmail) {
    this.createdByEmail = createdByEmail;
  }
}
