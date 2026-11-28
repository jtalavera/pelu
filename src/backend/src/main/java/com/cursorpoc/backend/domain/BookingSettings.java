package com.cursorpoc.backend.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OneToOne;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * A salon's online booking settings (one row per tenant). A0 holds only the address and the switch.
 */
@Entity
@Table(name = "booking_settings")
public class BookingSettings {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @OneToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "tenant_id", nullable = false)
  private Tenant tenant;

  /**
   * The salon's public address, unique across the platform (enforced by a filtered unique index).
   */
  @Column(length = 40)
  private String slug;

  @Column(name = "accepting_bookings", nullable = false)
  private boolean acceptingBookings;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  protected BookingSettings() {}

  public BookingSettings(Tenant tenant) {
    this.tenant = tenant;
    Instant now = Instant.now();
    this.createdAt = now;
    this.updatedAt = now;
  }

  public Long getId() {
    return id;
  }

  public Tenant getTenant() {
    return tenant;
  }

  public String getSlug() {
    return slug;
  }

  public void setSlug(String slug) {
    this.slug = slug;
    this.updatedAt = Instant.now();
  }

  public boolean isAcceptingBookings() {
    return acceptingBookings;
  }

  public void setAcceptingBookings(boolean acceptingBookings) {
    this.acceptingBookings = acceptingBookings;
    this.updatedAt = Instant.now();
  }

  public Instant getCreatedAt() {
    return createdAt;
  }

  public Instant getUpdatedAt() {
    return updatedAt;
  }
}
