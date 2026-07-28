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

  @Column(length = 500)
  private String address;

  /** SIFEN HU-02 AC-07 — descripción libre, no valida contra la tabla de códigos DNIT. */
  @Column(length = 120)
  private String department;

  /** SIFEN HU-02 AC-07 — descripción libre, no valida contra la tabla de códigos DNIT. */
  @Column(length = 120)
  private String city;

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

  public String getAddress() {
    return address;
  }

  public void setAddress(String address) {
    this.address = address;
  }

  public String getDepartment() {
    return department;
  }

  public void setDepartment(String department) {
    this.department = department;
  }

  public String getCity() {
    return city;
  }

  public void setCity(String city) {
    this.city = city;
  }
}
