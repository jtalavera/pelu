package com.cursorpoc.backend.web;

import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.excelimport.ExcelHeaderValidationService;
import com.cursorpoc.backend.excelimport.HeaderValidationResult;
import com.cursorpoc.backend.excelimport.ImportColumnDefinition;
import com.cursorpoc.backend.excelimport.ImportColumnTemplateRegistry;
import com.cursorpoc.backend.excelimport.ImportEntityType;
import com.cursorpoc.backend.excelimport.ImportExampleFileGenerator;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.web.dto.ImportColumnResponse;
import com.cursorpoc.backend.web.dto.ImportColumnTemplateResponse;
import com.cursorpoc.backend.web.dto.ValidateImportHeadersRequest;
import com.cursorpoc.backend.web.dto.ValidateImportHeadersResponse;
import java.util.Base64;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-50 (Épica E — Importación de datos vía Excel): standard column template per importable entity
 * (AC-1..AC-4, documented for the Platform Admin at import time — AC-7) plus a headers-only file
 * check (AC-5/AC-6). Deliberately does NOT parse data rows or create any record — that is
 * HU-51/HU-52/HU-53, one per entity. HU-55 adds a downloadable example {@code .xlsx} per entity
 * (header row + sample data rows), generated from the same {@link ImportColumnTemplateRegistry} so
 * it can never diverge from what is validated on upload. Platform-Admin-only, tenant-independent
 * (no {@code tid} on the caller's token, see HU-34), same gating pattern as {@code
 * PlatformTierController}.
 */
@RestController
@RequestMapping("/api/platform/import-templates")
public class PlatformImportTemplateController {

  private static final Logger log = LoggerFactory.getLogger(PlatformImportTemplateController.class);

  private final ImportColumnTemplateRegistry templateRegistry;
  private final ExcelHeaderValidationService headerValidationService;
  private final ImportExampleFileGenerator exampleFileGenerator;

  public PlatformImportTemplateController(
      ImportColumnTemplateRegistry templateRegistry,
      ExcelHeaderValidationService headerValidationService,
      ImportExampleFileGenerator exampleFileGenerator) {
    this.templateRegistry = templateRegistry;
    this.headerValidationService = headerValidationService;
    this.exampleFileGenerator = exampleFileGenerator;
  }

  /** AC-1/AC-2/AC-3/AC-4/AC-7: the three standard templates, one per importable entity. */
  @GetMapping
  public List<ImportColumnTemplateResponse> listTemplates(
      @AuthenticationPrincipal FemmeUserPrincipal principal) {
    requirePlatformAdmin(principal, "GET /api/platform/import-templates");
    log.info("GET /api/platform/import-templates adminUserId={}", principal.getUserId());
    List<ImportColumnTemplateResponse> response =
        templateRegistry.allTemplates().entrySet().stream()
            .map(
                entry ->
                    new ImportColumnTemplateResponse(
                        entry.getKey().pathSegment(), toColumnResponses(entry.getValue())))
            .sorted((a, b) -> a.entity().compareTo(b.entity()))
            .toList();
    log.info(
        "GET /api/platform/import-templates adminUserId={} status=200 count={}",
        principal.getUserId(),
        response.size());
    return response;
  }

  /**
   * HU-55 AC-1/AC-2/AC-3/AC-4: a ready-to-fill example {@code .xlsx} for the given entity — the
   * exact header row {@link ImportColumnTemplateRegistry} defines (never diverging from what {@code
   * validate-headers} and the actual import accept) plus 1-2 fictional sample data rows.
   */
  @GetMapping("/{entity}/example-file")
  public ResponseEntity<byte[]> downloadExampleFile(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("entity") String entity) {
    String routeLabel = "GET /api/platform/import-templates/{entity}/example-file";
    requirePlatformAdmin(principal, routeLabel);
    ImportEntityType entityType = ImportEntityType.fromPathSegment(entity);
    if (entityType == null) {
      log.error(
          "{} adminUserId={} status=404 - unknown entity={}",
          routeLabel,
          principal.getUserId(),
          entity);
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "IMPORT_ENTITY_NOT_FOUND");
    }
    log.info("{} adminUserId={} entity={}", routeLabel, principal.getUserId(), entity);
    byte[] fileBytes = exampleFileGenerator.generate(entityType);
    String fileName = exampleFileGenerator.fileNameFor(entityType);
    log.info(
        "{} adminUserId={} entity={} status=200 bytes={}",
        routeLabel,
        principal.getUserId(),
        entity,
        fileBytes.length);
    return ResponseEntity.ok()
        .header(
            HttpHeaders.CONTENT_TYPE,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + fileName + "\"")
        .body(fileBytes);
  }

  /**
   * AC-5/AC-6: validates only the candidate file's extension, readability, and header row against
   * the given entity's required columns — never parses data rows, never creates any record.
   */
  @PostMapping("/{entity}/validate-headers")
  public ValidateImportHeadersResponse validateHeaders(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("entity") String entity,
      @RequestBody ValidateImportHeadersRequest request) {
    String routeLabel = "POST /api/platform/import-templates/{entity}/validate-headers";
    requirePlatformAdmin(principal, routeLabel);
    ImportEntityType entityType = ImportEntityType.fromPathSegment(entity);
    if (entityType == null) {
      log.error(
          "{} adminUserId={} status=404 - unknown entity={}",
          routeLabel,
          principal.getUserId(),
          entity);
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "IMPORT_ENTITY_NOT_FOUND");
    }
    log.info(
        "{} adminUserId={} entity={} fileName={}",
        routeLabel,
        principal.getUserId(),
        entity,
        request.fileName());

    if (!headerValidationService.hasValidExtension(request.fileName())) {
      log.error(
          "{} adminUserId={} entity={} status=200 result=INVALID_FILE_EXTENSION",
          routeLabel,
          principal.getUserId(),
          entity);
      return new ValidateImportHeadersResponse(false, "INVALID_FILE_EXTENSION", List.of());
    }

    byte[] fileBytes;
    try {
      fileBytes =
          Base64.getDecoder().decode(request.fileBase64() == null ? "" : request.fileBase64());
    } catch (IllegalArgumentException ex) {
      log.error(
          "{} adminUserId={} entity={} status=200 result=CORRUPT_FILE (invalid base64)",
          routeLabel,
          principal.getUserId(),
          entity);
      return new ValidateImportHeadersResponse(false, "CORRUPT_FILE", List.of());
    }

    HeaderValidationResult result = headerValidationService.validateHeaders(fileBytes, entityType);
    log.info(
        "{} adminUserId={} entity={} status=200 valid={} errorCode={} missingCount={}",
        routeLabel,
        principal.getUserId(),
        entity,
        result.valid(),
        result.errorCode(),
        result.missingRequiredColumns().size());
    return new ValidateImportHeadersResponse(
        result.valid(), result.errorCode(), result.missingRequiredColumns());
  }

  private static List<ImportColumnResponse> toColumnResponses(List<ImportColumnDefinition> cols) {
    return cols.stream().map(c -> new ImportColumnResponse(c.key(), c.required())).toList();
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
