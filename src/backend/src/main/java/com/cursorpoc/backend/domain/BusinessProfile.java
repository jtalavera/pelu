package com.cursorpoc.backend.domain;

import com.cursorpoc.backend.domain.enums.SifenTaxpayerType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
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

  /** Tipo de contribuyente (SIFEN D103/iTipCont) — SIFEN HU-02 AC-03, nullable until configured. */
  @Enumerated(EnumType.STRING)
  @Column(name = "taxpayer_type", length = 20)
  private SifenTaxpayerType taxpayerType;

  /** Código de actividad económica (SIFEN D131/cActEco) — SIFEN HU-02 AC-03. */
  @Column(name = "economic_activity_code", length = 20)
  private String economicActivityCode;

  /** Descripción de la actividad económica (SIFEN D132/dDesActEco) — SIFEN HU-02 AC-03. */
  @Column(name = "economic_activity_description", length = 300)
  private String economicActivityDescription;

  /** Código del departamento de emisión (SIFEN D111/cDepEmi) — SIFEN HU-04. */
  @Column(name = "sifen_department_code", length = 4)
  private String sifenDepartmentCode;

  /** Descripción del departamento de emisión (SIFEN D112/dDesDepEmi) — SIFEN HU-04. */
  @Column(name = "sifen_department_name", length = 64)
  private String sifenDepartmentName;

  /** Código de la ciudad de emisión (SIFEN D115/cCiuEmi) — SIFEN HU-04. */
  @Column(name = "sifen_city_code", length = 8)
  private String sifenCityCode;

  /** Descripción de la ciudad de emisión (SIFEN D116/dDesCiuEmi) — SIFEN HU-04. */
  @Column(name = "sifen_city_name", length = 64)
  private String sifenCityName;

  /** Nombre de fantasía (SIFEN D106/dNomFanEmi, opcional) — SIFEN HU-08 AC-03. */
  @Column(name = "sifen_fantasy_name", length = 255)
  private String sifenFantasyName;

  /** Mensaje libre configurable impreso en el KuDE, nunca enviado a SIFEN — SIFEN HU-08 AC-11. */
  @Column(name = "kude_footer_message", length = 500)
  private String kudeFooterMessage;

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

  public SifenTaxpayerType getTaxpayerType() {
    return taxpayerType;
  }

  public void setTaxpayerType(SifenTaxpayerType taxpayerType) {
    this.taxpayerType = taxpayerType;
  }

  public String getEconomicActivityCode() {
    return economicActivityCode;
  }

  public void setEconomicActivityCode(String economicActivityCode) {
    this.economicActivityCode = economicActivityCode;
  }

  public String getEconomicActivityDescription() {
    return economicActivityDescription;
  }

  public void setEconomicActivityDescription(String economicActivityDescription) {
    this.economicActivityDescription = economicActivityDescription;
  }

  public String getSifenDepartmentCode() {
    return sifenDepartmentCode;
  }

  public void setSifenDepartmentCode(String sifenDepartmentCode) {
    this.sifenDepartmentCode = sifenDepartmentCode;
  }

  public String getSifenDepartmentName() {
    return sifenDepartmentName;
  }

  public void setSifenDepartmentName(String sifenDepartmentName) {
    this.sifenDepartmentName = sifenDepartmentName;
  }

  public String getSifenCityCode() {
    return sifenCityCode;
  }

  public void setSifenCityCode(String sifenCityCode) {
    this.sifenCityCode = sifenCityCode;
  }

  public String getSifenCityName() {
    return sifenCityName;
  }

  public void setSifenCityName(String sifenCityName) {
    this.sifenCityName = sifenCityName;
  }

  public String getSifenFantasyName() {
    return sifenFantasyName;
  }

  public void setSifenFantasyName(String sifenFantasyName) {
    this.sifenFantasyName = sifenFantasyName;
  }

  public String getKudeFooterMessage() {
    return kudeFooterMessage;
  }

  public void setKudeFooterMessage(String kudeFooterMessage) {
    this.kudeFooterMessage = kudeFooterMessage;
  }
}
