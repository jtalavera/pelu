package com.cursorpoc.backend.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.LocalDateTime;

/**
 * HU-54 (Épica E — Importación de datos vía Excel) AC-4: last import attempt (success or rejection)
 * of one entity type for one tenant. One row per (tenant_id, entity_type), overwritten on each new
 * import for that pair, same "single last result" convention as {@link TenantStatusChange}. Per-row
 * outcomes live separately in {@link TenantImportRunRow}.
 */
@Entity
@Table(
    name = "tenant_import_runs",
    uniqueConstraints = @UniqueConstraint(columnNames = {"tenant_id", "entity_type"}))
public class TenantImportRun {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "tenant_id", nullable = false)
  private Long tenantId;

  @Column(name = "entity_type", nullable = false, length = 20)
  private String entityType;

  @Column(name = "file_name", nullable = false, length = 260)
  private String fileName;

  @Column(name = "file_accepted", nullable = false)
  private boolean fileAccepted;

  @Column(name = "error_code", length = 60)
  private String errorCode;

  @Column(name = "missing_required_columns", length = 500)
  private String missingRequiredColumns;

  @Column(name = "total_rows", nullable = false)
  private int totalRows;

  @Column(name = "imported_count", nullable = false)
  private int importedCount;

  @Column(name = "failed_count", nullable = false)
  private int failedCount;

  @Column(name = "imported_at", nullable = false)
  private LocalDateTime importedAt;

  @Column(name = "imported_by_user_id", nullable = false)
  private Long importedByUserId;

  @Column(name = "imported_by_email", nullable = false, length = 320)
  private String importedByEmail;

  public Long getId() {
    return id;
  }

  public void setId(Long id) {
    this.id = id;
  }

  public Long getTenantId() {
    return tenantId;
  }

  public void setTenantId(Long tenantId) {
    this.tenantId = tenantId;
  }

  public String getEntityType() {
    return entityType;
  }

  public void setEntityType(String entityType) {
    this.entityType = entityType;
  }

  public String getFileName() {
    return fileName;
  }

  public void setFileName(String fileName) {
    this.fileName = fileName;
  }

  public boolean isFileAccepted() {
    return fileAccepted;
  }

  public void setFileAccepted(boolean fileAccepted) {
    this.fileAccepted = fileAccepted;
  }

  public String getErrorCode() {
    return errorCode;
  }

  public void setErrorCode(String errorCode) {
    this.errorCode = errorCode;
  }

  public String getMissingRequiredColumns() {
    return missingRequiredColumns;
  }

  public void setMissingRequiredColumns(String missingRequiredColumns) {
    this.missingRequiredColumns = missingRequiredColumns;
  }

  public int getTotalRows() {
    return totalRows;
  }

  public void setTotalRows(int totalRows) {
    this.totalRows = totalRows;
  }

  public int getImportedCount() {
    return importedCount;
  }

  public void setImportedCount(int importedCount) {
    this.importedCount = importedCount;
  }

  public int getFailedCount() {
    return failedCount;
  }

  public void setFailedCount(int failedCount) {
    this.failedCount = failedCount;
  }

  public LocalDateTime getImportedAt() {
    return importedAt;
  }

  public void setImportedAt(LocalDateTime importedAt) {
    this.importedAt = importedAt;
  }

  public Long getImportedByUserId() {
    return importedByUserId;
  }

  public void setImportedByUserId(Long importedByUserId) {
    this.importedByUserId = importedByUserId;
  }

  public String getImportedByEmail() {
    return importedByEmail;
  }

  public void setImportedByEmail(String importedByEmail) {
    this.importedByEmail = importedByEmail;
  }
}
