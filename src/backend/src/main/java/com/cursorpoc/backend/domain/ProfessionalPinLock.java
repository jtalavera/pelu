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
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** HU-66: consecutive failed PINs (and the resulting lock) of one professional on one device. */
@Entity
@Table(
    name = "professional_pin_locks",
    uniqueConstraints = @UniqueConstraint(columnNames = {"device_id", "professional_id"}))
public class ProfessionalPinLock {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "device_id", nullable = false)
  private SharedDevice device;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "professional_id", nullable = false)
  private Professional professional;

  @Column(name = "failed_count", nullable = false)
  private int failedCount;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "locked_until")
  private Instant lockedUntil;

  public Long getId() {
    return id;
  }

  public SharedDevice getDevice() {
    return device;
  }

  public void setDevice(SharedDevice device) {
    this.device = device;
  }

  public Professional getProfessional() {
    return professional;
  }

  public void setProfessional(Professional professional) {
    this.professional = professional;
  }

  public int getFailedCount() {
    return failedCount;
  }

  public void setFailedCount(int failedCount) {
    this.failedCount = failedCount;
  }

  public Instant getLockedUntil() {
    return lockedUntil;
  }

  public void setLockedUntil(Instant lockedUntil) {
    this.lockedUntil = lockedUntil;
  }

  public boolean isLockedAt(Instant now) {
    return lockedUntil != null && now.isBefore(lockedUntil);
  }
}
