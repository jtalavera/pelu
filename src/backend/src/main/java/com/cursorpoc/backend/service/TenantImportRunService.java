package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.TenantImportRun;
import com.cursorpoc.backend.domain.TenantImportRunRow;
import com.cursorpoc.backend.excelimport.ImportEntityType;
import com.cursorpoc.backend.excelimport.ImportResult;
import com.cursorpoc.backend.excelimport.ImportRowOutcome;
import com.cursorpoc.backend.repository.TenantImportRunRepository;
import com.cursorpoc.backend.repository.TenantImportRunRowRepository;
import com.cursorpoc.backend.web.dto.ImportReportResponse;
import com.cursorpoc.backend.web.dto.ImportRowResultResponse;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * HU-54 (Épica E — Importación de datos vía Excel) AC-4: persists the outcome of every import
 * attempt (accepted or rejected) so the Platform Admin can revisit "the report of the last import"
 * of a tenant/entity pair later, not only right after running it. One {@link TenantImportRun} per
 * (tenant, entity), overwritten on each new attempt — same "single last result" convention as
 * {@code TenantAdminService#recordStatusChange}; its {@link TenantImportRunRow} children are
 * replaced wholesale alongside it.
 */
@Service
public class TenantImportRunService {

  private final TenantImportRunRepository importRunRepository;
  private final TenantImportRunRowRepository importRunRowRepository;
  private final FemmeTimeProperties timeProperties;

  public TenantImportRunService(
      TenantImportRunRepository importRunRepository,
      TenantImportRunRowRepository importRunRowRepository,
      FemmeTimeProperties timeProperties) {
    this.importRunRepository = importRunRepository;
    this.importRunRowRepository = importRunRowRepository;
    this.timeProperties = timeProperties;
  }

  @Transactional
  public void recordRun(
      Long tenantId,
      ImportEntityType entityType,
      String fileName,
      ImportResult result,
      Long importedByUserId,
      String importedByEmail) {
    TenantImportRun run =
        importRunRepository
            .findByTenantIdAndEntityType(tenantId, entityType.name())
            .orElseGet(
                () -> {
                  TenantImportRun r = new TenantImportRun();
                  r.setTenantId(tenantId);
                  r.setEntityType(entityType.name());
                  return r;
                });
    run.setFileName(fileName);
    run.setFileAccepted(result.fileAccepted());
    run.setErrorCode(result.errorCode());
    run.setMissingRequiredColumns(
        result.missingRequiredColumns().isEmpty()
            ? null
            : String.join(",", result.missingRequiredColumns()));
    run.setTotalRows(result.totalRows());
    run.setImportedCount(result.importedCount());
    run.setFailedCount(result.failedCount());
    run.setImportedAt(LocalDateTime.now(timeProperties.zoneId()));
    run.setImportedByUserId(importedByUserId);
    run.setImportedByEmail(importedByEmail);
    run = importRunRepository.save(run);

    importRunRowRepository.deleteByImportRunId(run.getId());
    if (!result.rows().isEmpty()) {
      Long runId = run.getId();
      List<TenantImportRunRow> rows =
          result.rows().stream().map((ImportRowOutcome o) -> toRow(runId, o)).toList();
      importRunRowRepository.saveAll(rows);
    }
  }

  @Transactional(readOnly = true)
  public ImportReportResponse getReport(Long tenantId, ImportEntityType entityType) {
    return importRunRepository
        .findByTenantIdAndEntityType(tenantId, entityType.name())
        .map(this::toReportResponse)
        .orElseGet(ImportReportResponse::unavailable);
  }

  private static TenantImportRunRow toRow(Long importRunId, ImportRowOutcome outcome) {
    TenantImportRunRow row = new TenantImportRunRow();
    row.setImportRunId(importRunId);
    row.setRowNumber(outcome.rowNumber());
    row.setImported(outcome.imported());
    row.setErrorCode(outcome.errorCode());
    row.setName(outcome.name());
    return row;
  }

  private ImportReportResponse toReportResponse(TenantImportRun run) {
    List<ImportRowResultResponse> rows =
        importRunRowRepository.findByImportRunIdOrderByRowNumberAsc(run.getId()).stream()
            .map(
                r ->
                    new ImportRowResultResponse(
                        r.getRowNumber(), r.isImported(), r.getErrorCode(), r.getName()))
            .toList();
    List<String> missingRequiredColumns =
        (run.getMissingRequiredColumns() == null || run.getMissingRequiredColumns().isBlank())
            ? List.of()
            : List.of(run.getMissingRequiredColumns().split(","));
    return new ImportReportResponse(
        true,
        run.getFileName(),
        run.getImportedAt().atZone(timeProperties.zoneId()).toInstant(),
        run.getImportedByEmail(),
        run.isFileAccepted(),
        run.getErrorCode(),
        missingRequiredColumns,
        run.getTotalRows(),
        run.getImportedCount(),
        run.getFailedCount(),
        rows);
  }
}
