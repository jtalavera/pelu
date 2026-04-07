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
import java.time.LocalDate;

@Entity
@Table(name = "fiscal_stamps")
public class FiscalStamp {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "tenant_id", nullable = false)
  private Tenant tenant;

  @Column(name = "stamp_number", nullable = false, length = 64)
  private String stampNumber;

  @Column(name = "valid_from", nullable = false)
  private LocalDate validFrom;

  @Column(name = "valid_until", nullable = false)
  private LocalDate validUntil;

  @Column(name = "range_from", nullable = false)
  private int rangeFrom;

  @Column(name = "range_to", nullable = false)
  private int rangeTo;

  @Column(name = "next_emission_number", nullable = false)
  private int nextEmissionNumber;

  @Column(nullable = false)
  private boolean active;

  @Column(name = "locked_after_invoice", nullable = false)
  private boolean lockedAfterInvoice;

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

  public String getStampNumber() {
    return stampNumber;
  }

  public void setStampNumber(String stampNumber) {
    this.stampNumber = stampNumber;
  }

  public LocalDate getValidFrom() {
    return validFrom;
  }

  public void setValidFrom(LocalDate validFrom) {
    this.validFrom = validFrom;
  }

  public LocalDate getValidUntil() {
    return validUntil;
  }

  public void setValidUntil(LocalDate validUntil) {
    this.validUntil = validUntil;
  }

  public int getRangeFrom() {
    return rangeFrom;
  }

  public void setRangeFrom(int rangeFrom) {
    this.rangeFrom = rangeFrom;
  }

  public int getRangeTo() {
    return rangeTo;
  }

  public void setRangeTo(int rangeTo) {
    this.rangeTo = rangeTo;
  }

  public int getNextEmissionNumber() {
    return nextEmissionNumber;
  }

  public void setNextEmissionNumber(int nextEmissionNumber) {
    this.nextEmissionNumber = nextEmissionNumber;
  }

  public boolean isActive() {
    return active;
  }

  public void setActive(boolean active) {
    this.active = active;
  }

  public boolean isLockedAfterInvoice() {
    return lockedAfterInvoice;
  }

  public void setLockedAfterInvoice(boolean lockedAfterInvoice) {
    this.lockedAfterInvoice = lockedAfterInvoice;
  }
}
