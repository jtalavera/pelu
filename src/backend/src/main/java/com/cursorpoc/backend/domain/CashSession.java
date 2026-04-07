package com.cursorpoc.backend.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
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
@Table(name = "cash_sessions")
public class CashSession {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "tenant_id", nullable = false)
  private Tenant tenant;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "opened_by_user_id", nullable = false)
  private AppUser openedByUser;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "opened_at", nullable = false)
  private Instant openedAt;

  @Column(name = "opening_cash_amount", nullable = false, precision = 19, scale = 2)
  private BigDecimal openingCashAmount;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "closed_at")
  private Instant closedAt;

  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "closed_by_user_id")
  private AppUser closedByUser;

  @Column(name = "counted_cash_amount", precision = 19, scale = 2)
  private BigDecimal countedCashAmount;

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

  public AppUser getOpenedByUser() {
    return openedByUser;
  }

  public void setOpenedByUser(AppUser openedByUser) {
    this.openedByUser = openedByUser;
  }

  public Instant getOpenedAt() {
    return openedAt;
  }

  public void setOpenedAt(Instant openedAt) {
    this.openedAt = openedAt;
  }

  public BigDecimal getOpeningCashAmount() {
    return openingCashAmount;
  }

  public void setOpeningCashAmount(BigDecimal openingCashAmount) {
    this.openingCashAmount = openingCashAmount;
  }

  public Instant getClosedAt() {
    return closedAt;
  }

  public void setClosedAt(Instant closedAt) {
    this.closedAt = closedAt;
  }

  public AppUser getClosedByUser() {
    return closedByUser;
  }

  public void setClosedByUser(AppUser closedByUser) {
    this.closedByUser = closedByUser;
  }

  public BigDecimal getCountedCashAmount() {
    return countedCashAmount;
  }

  public void setCountedCashAmount(BigDecimal countedCashAmount) {
    this.countedCashAmount = countedCashAmount;
  }
}
