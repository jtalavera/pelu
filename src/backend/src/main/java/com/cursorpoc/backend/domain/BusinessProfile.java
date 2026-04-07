package com.cursorpoc.backend.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.MapsId;
import jakarta.persistence.OneToOne;
import jakarta.persistence.Table;

@Entity
@Table(name = "business_profiles")
public class BusinessProfile {

  @Id
  @Column(name = "tenant_id")
  private Long tenantId;

  @OneToOne(fetch = FetchType.LAZY, optional = false)
  @MapsId
  @JoinColumn(name = "tenant_id")
  private Tenant tenant;

  @Column(name = "business_name", nullable = false)
  private String businessName;

  @Column(length = 32)
  private String ruc;

  @Column(length = 500)
  private String address;

  @Column(length = 64)
  private String phone;

  @Column(name = "contact_email", length = 320)
  private String contactEmail;

  /**
   * Matches Flyway: NVARCHAR(MAX). Do not use @Lob — SQL Server maps LOB to CLOB and validation
   * fails.
   */
  @Column(name = "logo_data_url", columnDefinition = "NVARCHAR(MAX)")
  private String logoDataUrl;

  public Long getTenantId() {
    return tenantId;
  }

  public void setTenantId(Long tenantId) {
    this.tenantId = tenantId;
  }

  public Tenant getTenant() {
    return tenant;
  }

  public void setTenant(Tenant tenant) {
    this.tenant = tenant;
  }

  public String getBusinessName() {
    return businessName;
  }

  public void setBusinessName(String businessName) {
    this.businessName = businessName;
  }

  public String getRuc() {
    return ruc;
  }

  public void setRuc(String ruc) {
    this.ruc = ruc;
  }

  public String getAddress() {
    return address;
  }

  public void setAddress(String address) {
    this.address = address;
  }

  public String getPhone() {
    return phone;
  }

  public void setPhone(String phone) {
    this.phone = phone;
  }

  public String getContactEmail() {
    return contactEmail;
  }

  public void setContactEmail(String contactEmail) {
    this.contactEmail = contactEmail;
  }

  public String getLogoDataUrl() {
    return logoDataUrl;
  }

  public void setLogoDataUrl(String logoDataUrl) {
    this.logoDataUrl = logoDataUrl;
  }
}
