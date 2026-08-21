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
import com.cursorpoc.backend.web.dto.ImportFileRequest;
import com.cursorpoc.backend.web.dto.ImportResultResponse;
import com.cursorpoc.backend.web.dto.ImportRowResultResponse;
import java.util.Base64;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
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
 * PlatformImportTemplateController} routes).
 */
@RestController
@RequestMapping("/api/platform/tenants/{tenantId}/import")
public class PlatformTenantImportController {

  private static final Logger log = LoggerFactory.getLogger(PlatformTenantImportController.class);

  private final ExcelHeaderValidationService headerValidationService;
  private final ServiceImportService serviceImportService;
  private final ClientImportService clientImportService;
  private final ProfessionalImportService professionalImportService;

  public PlatformTenantImportController(
      ExcelHeaderValidationService headerValidationService,
      ServiceImportService serviceImportService,
      ClientImportService clientImportService,
      ProfessionalImportService professionalImportService) {
    this.headerValidationService = headerValidationService;
    this.serviceImportService = serviceImportService;
    this.clientImportService = clientImportService;
    this.professionalImportService = professionalImportService;
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
      return toRejectedResponse(ImportResult.fileError("INVALID_FILE_EXTENSION"));
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
      return toRejectedResponse(ImportResult.fileError("CORRUPT_FILE"));
    }

    try {
      ImportResult result =
          switch (entityType) {
            case CLIENTS -> clientImportService.importClients(tenantId, fileBytes);
            case PROFESSIONALS ->
                professionalImportService.importProfessionals(tenantId, fileBytes);
            case SERVICES -> serviceImportService.importServices(tenantId, fileBytes);
          };
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
