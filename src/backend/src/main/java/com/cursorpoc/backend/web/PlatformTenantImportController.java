package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.excelimport.ExcelHeaderValidationService;
import com.cursorpoc.backend.excelimport.ImportEntityType;
import com.cursorpoc.backend.excelimport.ImportResult;
import com.cursorpoc.backend.excelimport.ImportRowOutcome;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.ClientImportService;
import com.cursorpoc.backend.service.ProfessionalImportService;
import com.cursorpoc.backend.service.ServiceImportService;
import com.cursorpoc.backend.service.TenantImportRunService;
import com.cursorpoc.backend.web.dto.ImportFileRequest;
import com.cursorpoc.backend.web.dto.ImportReportResponse;
import com.cursorpoc.backend.web.dto.ImportResultResponse;
import com.cursorpoc.backend.web.dto.ImportRowResultResponse;
import java.util.Base64;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-51/HU-52/HU-53 (Épica E — Importación de datos vía Excel): the actual upload → parse data rows
 * → validate row-by-row → persist flow for the "servicios", "clientes" and "profesionales"
 * entities, extending HU-50's headers-only foundation. Platform-Admin-only, tenant-scoped (the
 * target tenant is chosen explicitly by the caller — AC-1 — unlike the tenant-independent {@code
 * PlatformImportTemplateController} routes). HU-54 adds: every attempt (accepted or rejected) is
 * persisted via {@link TenantImportRunService}, and {@code GET .../report} reads back the last one.
 */
@RestController
@RequestMapping("/api/platform/tenants/{tenantId}/import")
public class PlatformTenantImportController {

  private static final Logger log = LoggerFactory.getLogger(PlatformTenantImportController.class);

  private final ExcelHeaderValidationService headerValidationService;
  private final ServiceImportService serviceImportService;
  private final ClientImportService clientImportService;
  private final ProfessionalImportService professionalImportService;
  private final TenantImportRunService importRunService;

  public PlatformTenantImportController(
      ExcelHeaderValidationService headerValidationService,
      ServiceImportService serviceImportService,
      ClientImportService clientImportService,
      ProfessionalImportService professionalImportService,
      TenantImportRunService importRunService) {
    this.headerValidationService = headerValidationService;
    this.serviceImportService = serviceImportService;
    this.clientImportService = clientImportService;
    this.professionalImportService = professionalImportService;
    this.importRunService = importRunService;
  }

  /**
   * AC-1: Platform Admin picks the target tenant (path variable) and uploads a candidate file for
   * one entity. AC-2..AC-5: rows are validated and persisted independently, per the PRD's
   * per-file-transactional import ("si una fila falla, las filas válidas igual se importan"). AC-7:
   * every created record is scoped to {@code tenantId} only.
   */
  @PostMapping("/{entity}")
  public ImportResultResponse importData(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("tenantId") Long tenantId,
      @PathVariable("entity") String entity,
      @RequestBody ImportFileRequest request) {
    String routeLabel = "POST /api/platform/tenants/{tenantId}/import/{entity}";
    requirePlatformAdmin(principal, routeLabel);
    ImportEntityType entityType = ImportEntityType.fromPathSegment(entity);
    log.info(
        "{} adminUserId={} tenantId={} entity={} fileName={}",
        routeLabel,
        principal.getUserId(),
        tenantId,
        entity,
        request.fileName());

    if (entityType == null) {
      log.error(
          "{} adminUserId={} tenantId={} status=404 - unknown entity={}",
          routeLabel,
          principal.getUserId(),
          tenantId,
          entity);
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "IMPORT_ENTITY_NOT_FOUND");
    }
    if (!headerValidationService.hasValidExtension(request.fileName())) {
      log.error(
          "{} adminUserId={} tenantId={} entity={} status=200 result=INVALID_FILE_EXTENSION",
          routeLabel,
          principal.getUserId(),
          tenantId,
          entity);
      ImportResult rejected = ImportResult.fileError("INVALID_FILE_EXTENSION");
      recordRun(tenantId, entityType, request.fileName(), rejected, principal);
      return toRejectedResponse(rejected);
    }

    byte[] fileBytes;
    try {
      fileBytes =
          Base64.getDecoder().decode(request.fileBase64() == null ? "" : request.fileBase64());
    } catch (IllegalArgumentException ex) {
      log.error(
          "{} adminUserId={} tenantId={} entity={} status=200 result=CORRUPT_FILE (invalid base64)",
          routeLabel,
          principal.getUserId(),
          tenantId,
          entity);
      ImportResult rejected = ImportResult.fileError("CORRUPT_FILE");
      recordRun(tenantId, entityType, request.fileName(), rejected, principal);
      return toRejectedResponse(rejected);
    }

    try {
      ImportResult result =
          switch (entityType) {
            case CLIENTS -> clientImportService.importClients(tenantId, fileBytes);
            case PROFESSIONALS ->
                professionalImportService.importProfessionals(tenantId, fileBytes);
            case SERVICES -> serviceImportService.importServices(tenantId, fileBytes);
          };
      recordRun(tenantId, entityType, request.fileName(), result, principal);
      ImportResultResponse response = toResponse(result);
      if (!response.fileAccepted()) {
        log.error(
            "{} adminUserId={} tenantId={} entity={} status=200 result=REJECTED errorCode={} missingCount={}",
            routeLabel,
            principal.getUserId(),
            tenantId,
            entity,
            response.errorCode(),
            response.missingRequiredColumns().size());
      } else {
        log.info(
            "{} adminUserId={} tenantId={} entity={} status=200 totalRows={} imported={} failed={}",
            routeLabel,
            principal.getUserId(),
            tenantId,
            entity,
            response.totalRows(),
            response.importedCount(),
            response.failedCount());
      }
      return response;
    } catch (ResponseStatusException ex) {
      log.error(
          "{} adminUserId={} tenantId={} entity={} status={} error={}",
          routeLabel,
          principal.getUserId(),
          tenantId,
          entity,
          ex.getStatusCode().value(),
          ex.getReason());
      throw ex;
    }
  }

  /**
   * HU-54 AC-1..AC-4: read back the persisted report of the last import attempt (accepted or
   * rejected) for this tenant/entity pair, so the Platform Admin can revisit it after leaving and
   * returning — {@code available=false} when no import has ever run yet for the pair.
   */
  @GetMapping("/{entity}/report")
  public ImportReportResponse getImportReport(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("tenantId") Long tenantId,
      @PathVariable("entity") String entity) {
    String routeLabel = "GET /api/platform/tenants/{tenantId}/import/{entity}/report";
    requirePlatformAdmin(principal, routeLabel);
    ImportEntityType entityType = ImportEntityType.fromPathSegment(entity);
    log.info(
        "{} adminUserId={} tenantId={} entity={}",
        routeLabel,
        principal.getUserId(),
        tenantId,
        entity);
    if (entityType == null) {
      log.error(
          "{} adminUserId={} tenantId={} status=404 - unknown entity={}",
          routeLabel,
          principal.getUserId(),
          tenantId,
          entity);
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "IMPORT_ENTITY_NOT_FOUND");
    }
    ImportReportResponse response = importRunService.getReport(tenantId, entityType);
    log.info(
        "{} adminUserId={} tenantId={} entity={} status=200 available={}",
        routeLabel,
        principal.getUserId(),
        tenantId,
        entity,
        response.available());
    return response;
  }

  private void recordRun(
      Long tenantId,
      ImportEntityType entityType,
      String fileName,
      ImportResult result,
      FemmeUserPrincipal principal) {
    importRunService.recordRun(
        tenantId, entityType, fileName, result, principal.getUserId(), principal.getUsername());
  }

  private static ImportResultResponse toRejectedResponse(ImportResult result) {
    return toResponse(result);
  }

  private static ImportResultResponse toResponse(ImportResult result) {
    List<ImportRowResultResponse> rows =
        result.rows().stream()
            .map(
                (ImportRowOutcome o) ->
                    new ImportRowResultResponse(
                        o.rowNumber(), o.imported(), o.errorCode(), o.name()))
            .toList();
    return new ImportResultResponse(
        result.fileAccepted(),
        result.errorCode(),
        result.missingRequiredColumns(),
        result.totalRows(),
        result.importedCount(),
        result.failedCount(),
        rows);
  }

  private static void requirePlatformAdmin(FemmeUserPrincipal principal, String routeLabel) {
    if (principal == null) {
      log.error("{} status=401 - no principal", routeLabel);
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    if (principal.getRole() != UserRole.PLATFORM_ADMIN) {
      log.error(
          "{} status=403 - role={} is not PLATFORM_ADMIN", routeLabel, principal.getRole().name());
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
  }
}
