package com.cursorpoc.backend.domain;

import com.cursorpoc.backend.domain.enums.CashMovementType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "cash_movements")
public class CashMovement {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "tenant_id", nullable = false)
  private Tenant tenant;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "cash_session_id", nullable = false)
  private CashSession cashSession;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 32)
  private CashMovementType type;

  @Column(nullable = false, precision = 19, scale = 2)
  private BigDecimal amount;

  @Column(length = 500)
  private String reason;

  @Column(name = "tip_withdrawal_id")
  private Long tipWithdrawalId;

  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "created_by_user_id")
  private AppUser createdByUser;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  public Long getId() {
    return id;
  }

  public void setId(Long id) {
    this.id = id;
  }

  public Tenant getTenant() {
    return tenant;
  }

  public void setTenant(Tenant tenant) {
    this.tenant = tenant;
  }

  public CashSession getCashSession() {
    return cashSession;
  }

  public void setCashSession(CashSession cashSession) {
    this.cashSession = cashSession;
  }

  public CashMovementType getType() {
    return type;
  }

  public void setType(CashMovementType type) {
    this.type = type;
  }

  public BigDecimal getAmount() {
    return amount;
  }

  public void setAmount(BigDecimal amount) {
    this.amount = amount;
  }

  public String getReason() {
    return reason;
  }

  public void setReason(String reason) {
    this.reason = reason;
  }

  public Long getTipWithdrawalId() {
    return tipWithdrawalId;
  }

  public void setTipWithdrawalId(Long tipWithdrawalId) {
    this.tipWithdrawalId = tipWithdrawalId;
  }

  public AppUser getCreatedByUser() {
    return createdByUser;
  }

  public void setCreatedByUser(AppUser createdByUser) {
    this.createdByUser = createdByUser;
  }

  public Instant getCreatedAt() {
    return createdAt;
  }

  public void setCreatedAt(Instant createdAt) {
    this.createdAt = createdAt;
  }
}
