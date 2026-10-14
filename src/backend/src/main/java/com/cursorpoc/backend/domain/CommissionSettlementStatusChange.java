package com.cursorpoc.backend.domain;

import com.cursorpoc.backend.domain.enums.CommissionSettlementStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** Módulo de comisiones: audit trail of settlement transitions. */
@Entity
@Table(name = "commission_settlement_status_changes")
public class CommissionSettlementStatusChange {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "settlement_id", nullable = false)
  private Long settlementId;

  @Enumerated(EnumType.STRING)
  @Column(name = "from_status", length = 16)
  private CommissionSettlementStatus fromStatus;

  @Enumerated(EnumType.STRING)
  @Column(name = "to_status", nullable = false, length = 16)
  private CommissionSettlementStatus toStatus;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "changed_at", nullable = false)
  private Instant changedAt;

  @Column(name = "changed_by_email", length = 320)
  private String changedByEmail;

  public Long getId() {
    return id;
  }

  public void setId(Long id) {
    this.id = id;
  }

  public Long getSettlementId() {
    return settlementId;
  }

  public void setSettlementId(Long settlementId) {
    this.settlementId = settlementId;
  }

  public CommissionSettlementStatus getFromStatus() {
    return fromStatus;
  }

  public void setFromStatus(CommissionSettlementStatus fromStatus) {
    this.fromStatus = fromStatus;
  }

  public CommissionSettlementStatus getToStatus() {
    return toStatus;
  }

  public void setToStatus(CommissionSettlementStatus toStatus) {
    this.toStatus = toStatus;
  }

  public Instant getChangedAt() {
    return changedAt;
  }

  public void setChangedAt(Instant changedAt) {
    this.changedAt = changedAt;
  }

  public String getChangedByEmail() {
    return changedByEmail;
  }

  public void setChangedByEmail(String changedByEmail) {
    this.changedByEmail = changedByEmail;
  }
}
