package com.cursorpoc.backend.domain;

import com.cursorpoc.backend.domain.enums.ClientIdentityDocumentType;
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
@Table(name = "clients")
public class Client {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @ManyToOne(fetch = FetchType.LAZY, optional = false)
  @JoinColumn(name = "tenant_id", nullable = false)
  private Tenant tenant;

  @Column(name = "full_name", nullable = false)
  private String fullName;

  @Column(length = 64)
  private String phone;

  @Column(length = 320)
  private String email;

  @Column(length = 32)
  private String ruc;

  @Column(nullable = false)
  private boolean active;

  @Column(name = "visit_count", nullable = false)
  private int visitCount;

  /** Cédula u otro documento de identidad, para clientes sin RUC — SIFEN HU-02 AC-05. */
  @Column(name = "identity_document_number", length = 32)
  private String identityDocumentNumber;

  /**
   * Tipo explícito de identificación (RUC, cédula, pasaporte, ...), reemplaza la detección
   * implícita por presencia de ruc/identityDocumentNumber. Nullable: registros legados sin tipo se
   * resuelven por la misma detección implícita al armar el XML SIFEN.
   */
  @Enumerated(EnumType.STRING)
  @Column(name = "identity_document_type", length = 20)
  private ClientIdentityDocumentType identityDocumentType;

  @Column(length = 500)
  private String address;

  /** SIFEN HU-02 AC-07 — D219/cDepRec, código DNIT del departamento (catálogo oficial). */
  @Column(name = "department_code", length = 4)
  private String departmentCode;

  /** SIFEN HU-02 AC-07 — D220/dDesDepRec, nombre correspondiente a {@link #departmentCode}. */
  @Column(name = "department", length = 120)
  private String departmentName;

  /** SIFEN HU-02 AC-07 — D223/cCiuRec, código DNIT de la ciudad (catálogo oficial). */
  @Column(name = "city_code", length = 8)
  private String cityCode;

  /** SIFEN HU-02 AC-07 — D224/dDesCiuRec, nombre correspondiente a {@link #cityCode}. */
  @Column(name = "city", length = 120)
  private String cityName;

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

  public String getFullName() {
    return fullName;
  }

  public void setFullName(String fullName) {
    this.fullName = fullName;
  }

  public String getPhone() {
    return phone;
  }

  public void setPhone(String phone) {
    this.phone = phone;
  }

  public String getEmail() {
    return email;
  }

  public void setEmail(String email) {
    this.email = email;
  }

  public String getRuc() {
    return ruc;
  }

  public void setRuc(String ruc) {
    this.ruc = ruc;
  }

  public boolean isActive() {
    return active;
  }

  public void setActive(boolean active) {
    this.active = active;
  }

  public int getVisitCount() {
    return visitCount;
  }

  public void setVisitCount(int visitCount) {
    this.visitCount = visitCount;
  }

  public String getIdentityDocumentNumber() {
    return identityDocumentNumber;
  }

  public void setIdentityDocumentNumber(String identityDocumentNumber) {
    this.identityDocumentNumber = identityDocumentNumber;
  }

  public ClientIdentityDocumentType getIdentityDocumentType() {
    return identityDocumentType;
  }

  public void setIdentityDocumentType(ClientIdentityDocumentType identityDocumentType) {
    this.identityDocumentType = identityDocumentType;
  }

  public String getAddress() {
    return address;
  }

  public void setAddress(String address) {
    this.address = address;
  }

  public String getDepartmentCode() {
    return departmentCode;
  }

  public void setDepartmentCode(String departmentCode) {
    this.departmentCode = departmentCode;
  }

  public String getDepartmentName() {
    return departmentName;
  }

  public void setDepartmentName(String departmentName) {
    this.departmentName = departmentName;
  }

  public String getCityCode() {
    return cityCode;
  }

  public void setCityCode(String cityCode) {
    this.cityCode = cityCode;
  }

  public String getCityName() {
    return cityName;
  }

  public void setCityName(String cityName) {
    this.cityName = cityName;
  }
}
