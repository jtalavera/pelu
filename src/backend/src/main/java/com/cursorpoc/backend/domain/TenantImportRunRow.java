package com.cursorpoc.backend.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * HU-54 AC-2: outcome of one data row of the {@link TenantImportRun} it belongs to — same shape as
 * {@link com.cursorpoc.backend.excelimport.ImportRowOutcome}, persisted so the report can be
 * revisited later (AC-4). Rows for a run are replaced wholesale every time the run is overwritten.
 */
@Entity
@Table(name = "tenant_import_run_rows")
public class TenantImportRunRow {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "import_run_id", nullable = false)
  private Long importRunId;

  @Column(name = "row_number", nullable = false)
  private int rowNumber;

  @Column(name = "imported", nullable = false)
  private boolean imported;

  @Column(name = "error_code", length = 60)
  private String errorCode;

  @Column(name = "name", length = 255)
  private String name;

  public Long getId() {
    return id;
  }

  public void setId(Long id) {
    this.id = id;
  }

  public Long getImportRunId() {
    return importRunId;
  }

  public void setImportRunId(Long importRunId) {
    this.importRunId = importRunId;
  }

  public int getRowNumber() {
    return rowNumber;
  }

  public void setRowNumber(int rowNumber) {
    this.rowNumber = rowNumber;
  }

  public boolean isImported() {
    return imported;
  }

  public void setImported(boolean imported) {
    this.imported = imported;
  }

  public String getErrorCode() {
    return errorCode;
  }

  public void setErrorCode(String errorCode) {
    this.errorCode = errorCode;
  }

  public String getName() {
    return name;
  }

  public void setName(String name) {
    this.name = name;
  }
}
