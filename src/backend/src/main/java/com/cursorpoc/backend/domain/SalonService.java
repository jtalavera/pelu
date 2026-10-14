package com.cursorpoc.backend.domain;

import com.cursorpoc.backend.domain.enums.ServiceKind;
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

@Entity
@Table(name = "services")
public class SalonService {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "tenant_id", nullable = false)
  private Tenant tenant;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "category_id", nullable = false)
  private ServiceCategory category;

  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "tax_id")
  private Tax tax;

  @Column(nullable = false)
  private String name;

  @Column(name = "price_minor", nullable = false, precision = 19, scale = 2)
  private BigDecimal priceMinor;

  @Column(name = "duration_minutes", nullable = false)
  private int durationMinutes;

  @Column(nullable = false)
  private boolean active;

  /** HU-59: SERVICE (default) or PRODUCT — only products are synchronised to control-stock. */
  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 16)
  private ServiceKind kind = ServiceKind.SERVICE;

  /** HU-59: optional product code shown in control-stock. */
  @Column(length = 64)
  private String sku;

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

  public ServiceCategory getCategory() {
    return category;
  }

  public void setCategory(ServiceCategory category) {
    this.category = category;
  }

  public Tax getTax() {
    return tax;
  }

  public void setTax(Tax tax) {
    this.tax = tax;
  }

  public String getName() {
    return name;
  }

  public void setName(String name) {
    this.name = name;
  }

  public BigDecimal getPriceMinor() {
    return priceMinor;
  }

  public void setPriceMinor(BigDecimal priceMinor) {
    this.priceMinor = priceMinor;
  }

  public int getDurationMinutes() {
    return durationMinutes;
  }

  public void setDurationMinutes(int durationMinutes) {
    this.durationMinutes = durationMinutes;
  }

  public boolean isActive() {
    return active;
  }

  public void setActive(boolean active) {
    this.active = active;
  }

  public ServiceKind getKind() {
    return kind;
  }

  public void setKind(ServiceKind kind) {
    this.kind = kind == null ? ServiceKind.SERVICE : kind;
  }

  public boolean isProduct() {
    return kind == ServiceKind.PRODUCT;
  }

  public String getSku() {
    return sku;
  }

  public void setSku(String sku) {
    this.sku = sku;
  }
}
