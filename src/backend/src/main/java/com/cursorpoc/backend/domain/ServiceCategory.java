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

@Entity
@Table(name = "service_categories")
public class ServiceCategory {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "tenant_id", nullable = false)
  private Tenant tenant;

  @Column(nullable = false)
  private String name;

  @Column(nullable = false)
  private boolean active;

  @Column(name = "accent_key", nullable = false, length = 32)
  private String accentKey = "stone";

  /** Catalog split: a category holds only SERVICE items or only PRODUCT items. */
  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 16)
  private ServiceKind kind = ServiceKind.SERVICE;

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

  public String getName() {
    return name;
  }

  public void setName(String name) {
    this.name = name;
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

  public String getAccentKey() {
    return accentKey;
  }

  public void setAccentKey(String accentKey) {
    this.accentKey = accentKey;
  }
}
