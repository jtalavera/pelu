package com.cursorpoc.backend.domain;

import com.cursorpoc.backend.domain.enums.ClientAcquisitionChannel;
import com.cursorpoc.backend.domain.enums.ClientIdentityDocumentType;
import com.cursorpoc.backend.domain.enums.ClientTaxpayerType;
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
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

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

  /**
   * Legacy counter, never incremented anywhere (always 0). Visits are counted from CLOSED service
   * records instead ({@code ClientService}); kept only because the column is NOT NULL.
   */
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

  /**
   * SIFEN D205/iTiContRec — solo aplica cuando el cliente se identifica por RUC. Nullable: sin
   * valor, el XML SIFEN usa {@link ClientTaxpayerType#PERSONA_FISICA} por defecto.
   */
  @Enumerated(EnumType.STRING)
  @Column(name = "taxpayer_type", length = 20)
  private ClientTaxpayerType taxpayerType;

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

  /** HU-68: ficha técnica — notas libres (una sola nota editable). */
  @Column(length = 2000)
  private String notes;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "notes_updated_at")
  private Instant notesUpdatedAt;

  /** Snapshot of the editor's display name (admin user or professional) at save time. */
  @Column(name = "notes_updated_by", length = 200)
  private String notesUpdatedBy;

  /** HU-68: ficha técnica — fórmula de color (texto libre). */
  @Column(name = "color_formula", length = 2000)
  private String colorFormula;

  @JdbcTypeCode(SqlTypes.TIMESTAMP)
  @Column(name = "color_formula_updated_at")
  private Instant colorFormulaUpdatedAt;

  @Column(name = "color_formula_updated_by", length = 200)
  private String colorFormulaUpdatedBy;

  /** HU-69: birthday — day and month together, year optional. */
  @Column(name = "birthday_day")
  private Integer birthdayDay;

  @Column(name = "birthday_month")
  private Integer birthdayMonth;

  @Column(name = "birthday_year")
  private Integer birthdayYear;

  /** HU-69: "¿Cómo nos conoció?". */
  @Enumerated(EnumType.STRING)
  @Column(name = "acquisition_channel", length = 30)
  private ClientAcquisitionChannel acquisitionChannel;

  /** Free-text detail, only when {@link #acquisitionChannel} is OTRO. */
  @Column(name = "acquisition_channel_other", length = 100)
  private String acquisitionChannelOther;

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

  public ClientTaxpayerType getTaxpayerType() {
    return taxpayerType;
  }

  public void setTaxpayerType(ClientTaxpayerType taxpayerType) {
    this.taxpayerType = taxpayerType;
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

  public String getNotes() {
    return notes;
  }

  public void setNotes(String notes) {
    this.notes = notes;
  }

  public Instant getNotesUpdatedAt() {
    return notesUpdatedAt;
  }

  public void setNotesUpdatedAt(Instant notesUpdatedAt) {
    this.notesUpdatedAt = notesUpdatedAt;
  }

  public String getNotesUpdatedBy() {
    return notesUpdatedBy;
  }

  public void setNotesUpdatedBy(String notesUpdatedBy) {
    this.notesUpdatedBy = notesUpdatedBy;
  }

  public String getColorFormula() {
    return colorFormula;
  }

  public void setColorFormula(String colorFormula) {
    this.colorFormula = colorFormula;
  }

  public Instant getColorFormulaUpdatedAt() {
    return colorFormulaUpdatedAt;
  }

  public void setColorFormulaUpdatedAt(Instant colorFormulaUpdatedAt) {
    this.colorFormulaUpdatedAt = colorFormulaUpdatedAt;
  }

  public String getColorFormulaUpdatedBy() {
    return colorFormulaUpdatedBy;
  }

  public void setColorFormulaUpdatedBy(String colorFormulaUpdatedBy) {
    this.colorFormulaUpdatedBy = colorFormulaUpdatedBy;
  }

  public Integer getBirthdayDay() {
    return birthdayDay;
  }

  public void setBirthdayDay(Integer birthdayDay) {
    this.birthdayDay = birthdayDay;
  }

  public Integer getBirthdayMonth() {
    return birthdayMonth;
  }

  public void setBirthdayMonth(Integer birthdayMonth) {
    this.birthdayMonth = birthdayMonth;
  }

  public Integer getBirthdayYear() {
    return birthdayYear;
  }

  public void setBirthdayYear(Integer birthdayYear) {
    this.birthdayYear = birthdayYear;
  }

  public ClientAcquisitionChannel getAcquisitionChannel() {
    return acquisitionChannel;
  }

  public void setAcquisitionChannel(ClientAcquisitionChannel acquisitionChannel) {
    this.acquisitionChannel = acquisitionChannel;
  }

  public String getAcquisitionChannelOther() {
    return acquisitionChannelOther;
  }

  public void setAcquisitionChannelOther(String acquisitionChannelOther) {
    this.acquisitionChannelOther = acquisitionChannelOther;
  }
}
