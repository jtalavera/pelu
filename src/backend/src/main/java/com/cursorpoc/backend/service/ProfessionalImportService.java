package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.excelimport.ExcelHeaderValidationService;
import com.cursorpoc.backend.excelimport.HeaderValidationResult;
import com.cursorpoc.backend.excelimport.ImportEntityType;
import com.cursorpoc.backend.excelimport.ImportResult;
import com.cursorpoc.backend.excelimport.ImportRowOutcome;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.util.EmailFormatValidator;
import com.cursorpoc.backend.util.ParaguayPhoneValidator;
import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-53 (Épica E — Importación de datos vía Excel): parses the data rows of a profesionales import
 * file (already header-validated by {@link ExcelHeaderValidationService}, HU-50 AC-5/AC-6) and
 * persists every valid row as a {@code Professional} for the target tenant. Per the PRD
 * ("transaccional por archivo: si una fila falla, las filas válidas igual se importan") each row is
 * validated and persisted independently — one bad row never rolls back or blocks the rest of the
 * file.
 *
 * <ul>
 *   <li>AC-2: a blank {@code nombre_completo} rejects only that row.
 *   <li>AC-3: every imported {@code Professional} is created with no {@code pinFingerprint} and
 *       {@code systemAccessAllowed=false} (the {@link Professional} defaults) — exactly like a
 *       manual alta (HU-22): PIN and system access are configured manually afterwards, never via
 *       Excel.
 *   <li>AC-4: a blank {@code activo} column defaults to active; only an explicit {@code NO} creates
 *       an inactive professional.
 *   <li>AC-5: only {@code nombre_completo} is required — {@code telefono}/{@code email}/{@code
 *       direccion}/{@code activo} may all be left blank.
 *   <li>AC-6: {@code telefono}/{@code email} reuse the same format rules as manual professional
 *       creation ({@code isCompleteParaguayPhone}/{@code isValidEmail} on the frontend, mirrored
 *       here by {@link ParaguayPhoneValidator}/{@link EmailFormatValidator}) plus the same
 *       per-tenant email uniqueness enforced by {@link
 *       com.cursorpoc.backend.web.ProfessionalController#create} ({@code
 *       PROFESSIONAL_EMAIL_DUPLICATE}, backed by the {@code UQ_professional_tenant_email} DB
 *       constraint) — a non-blank {@code email} that duplicates an existing professional of the
 *       tenant, or an earlier row of the same file, rejects that row.
 *   <li>AC-7 (isolation): every created {@code Professional} is scoped to the target tenant only.
 * </ul>
 */
@Service
public class ProfessionalImportService {

  private static final Logger log = LoggerFactory.getLogger(ProfessionalImportService.class);

  public static final String ERROR_FULL_NAME_REQUIRED = "IMPORT_ROW_PROFESSIONAL_NAME_REQUIRED";
  public static final String ERROR_PHONE_INVALID = "IMPORT_ROW_PHONE_INVALID";
  public static final String ERROR_EMAIL_INVALID = "IMPORT_ROW_EMAIL_INVALID";
  public static final String ERROR_EMAIL_DUPLICATE = "IMPORT_ROW_PROFESSIONAL_EMAIL_DUPLICATE";
  public static final String ERROR_ROW_FAILED = "IMPORT_ROW_FAILED";

  private static final String COL_NOMBRE_COMPLETO = "nombre_completo";
  private static final String COL_TELEFONO = "telefono";
  private static final String COL_EMAIL = "email";
  private static final String COL_DIRECCION = "direccion";
  private static final String COL_ACTIVO = "activo";

  private final TenantRepository tenantRepository;
  private final ProfessionalRepository professionalRepository;
  private final ExcelHeaderValidationService headerValidationService;

  public ProfessionalImportService(
      TenantRepository tenantRepository,
      ProfessionalRepository professionalRepository,
      ExcelHeaderValidationService headerValidationService) {
    this.tenantRepository = tenantRepository;
    this.professionalRepository = professionalRepository;
    this.headerValidationService = headerValidationService;
  }

  @Transactional
  public ImportResult importProfessionals(long tenantId, byte[] fileBytes) {
    Tenant tenant =
        tenantRepository
            .findById(tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND"));

    HeaderValidationResult headerResult =
        headerValidationService.validateHeaders(fileBytes, ImportEntityType.PROFESSIONALS);
    if (!headerResult.valid()) {
      if (headerResult.errorCode() != null) {
        return ImportResult.fileError(headerResult.errorCode());
      }
      return ImportResult.missingColumns(headerResult.missingRequiredColumns());
    }

    try (XSSFWorkbook workbook = new XSSFWorkbook(new ByteArrayInputStream(fileBytes))) {
      Sheet sheet = workbook.getSheetAt(0);
      Row headerRow = sheet.getRow(sheet.getFirstRowNum());
      Map<String, Integer> headerIndex = buildHeaderIndex(headerRow);

      // AC-6/AC-7: existing professionals of THIS tenant only — a different tenant's matching
      // email never counts as a duplicate.
      Set<String> seenEmails = new HashSet<>();
      for (Professional existing :
          professionalRepository.findByTenant_IdOrderByFullNameAsc(tenantId)) {
        addIfPresent(seenEmails, normalize(existing.getEmail()));
      }

      List<ImportRowOutcome> outcomes = new ArrayList<>();
      DataFormatter formatter = new DataFormatter();

      int firstDataRow = sheet.getFirstRowNum() + 1;
      int lastRow = sheet.getLastRowNum();
      for (int r = firstDataRow; r <= lastRow; r++) {
        Row row = sheet.getRow(r);
        if (isBlankRow(row)) {
          continue;
        }
        int excelRowNumber = r + 1;
        try {
          outcomes.add(processRow(tenant, row, excelRowNumber, headerIndex, formatter, seenEmails));
        } catch (Exception ex) {
          log.error(
              "importProfessionals tenantId={} row={} status=REJECTED error={}",
              tenantId,
              excelRowNumber,
              ERROR_ROW_FAILED,
              ex);
          outcomes.add(ImportRowOutcome.rejected(excelRowNumber, ERROR_ROW_FAILED, null));
        }
      }
      return ImportResult.completed(outcomes);
    } catch (ResponseStatusException ex) {
      throw ex;
    } catch (Exception ex) {
      log.error("importProfessionals tenantId={} status=REJECTED error=CORRUPT_FILE", tenantId, ex);
      return ImportResult.fileError("CORRUPT_FILE");
    }
  }

  private ImportRowOutcome processRow(
      Tenant tenant,
      Row row,
      int excelRowNumber,
      Map<String, Integer> headerIndex,
      DataFormatter formatter,
      Set<String> seenEmails) {
    String nombreCompleto = textValue(row, headerIndex.get(COL_NOMBRE_COMPLETO), formatter);
    String telefono = textValue(row, headerIndex.get(COL_TELEFONO), formatter);
    String email = textValue(row, headerIndex.get(COL_EMAIL), formatter);
    String direccion = textValue(row, headerIndex.get(COL_DIRECCION), formatter);
    String activo = textValue(row, headerIndex.get(COL_ACTIVO), formatter);

    if (isBlank(nombreCompleto)) {
      return ImportRowOutcome.rejected(excelRowNumber, ERROR_FULL_NAME_REQUIRED, null);
    }
    String fullName = nombreCompleto.trim();

    if (!isBlank(telefono) && !ParaguayPhoneValidator.isComplete(telefono)) {
      return ImportRowOutcome.rejected(excelRowNumber, ERROR_PHONE_INVALID, fullName);
    }

    if (!isBlank(email) && !EmailFormatValidator.isValid(email)) {
      return ImportRowOutcome.rejected(excelRowNumber, ERROR_EMAIL_INVALID, fullName);
    }
    String emailKey = normalize(email);
    if (emailKey != null && seenEmails.contains(emailKey)) {
      return ImportRowOutcome.rejected(excelRowNumber, ERROR_EMAIL_DUPLICATE, fullName);
    }

    boolean active = !"NO".equalsIgnoreCase(activo == null ? "" : activo.trim());

    // AC-3: no PIN, no system access — Professional's defaults (pinFingerprint=null,
    // systemAccessAllowed=false) are left untouched, exactly like a manual alta before HU-22's
    // separate PIN/access step.
    Professional professional = new Professional();
    professional.setTenant(tenant);
    professional.setFullName(fullName.toUpperCase(Locale.ROOT));
    professional.setPhone(isBlank(telefono) ? null : telefono.trim());
    professional.setEmail(isBlank(email) ? null : email.trim());
    professional.setAddress(isBlank(direccion) ? null : direccion.trim());
    professional.setActive(active);
    professionalRepository.save(professional);

    addIfPresent(seenEmails, emailKey);

    return ImportRowOutcome.imported(excelRowNumber, fullName);
  }

  private static void addIfPresent(Set<String> set, String value) {
    if (value != null) {
      set.add(value);
    }
  }

  private static Map<String, Integer> buildHeaderIndex(Row headerRow) {
    Map<String, Integer> map = new HashMap<>();
    DataFormatter formatter = new DataFormatter();
    for (Cell cell : headerRow) {
      String raw = formatter.formatCellValue(cell);
      if (raw != null && !raw.isBlank()) {
        map.putIfAbsent(normalizeHeader(raw), cell.getColumnIndex());
      }
    }
    return map;
  }

  private static boolean isBlankRow(Row row) {
    if (row == null) {
      return true;
    }
    DataFormatter formatter = new DataFormatter();
    for (Cell cell : row) {
      String raw = formatter.formatCellValue(cell);
      if (raw != null && !raw.isBlank()) {
        return false;
      }
    }
    return true;
  }

  private static String textValue(Row row, Integer colIndex, DataFormatter formatter) {
    if (colIndex == null) {
      return null;
    }
    Cell cell = row.getCell(colIndex);
    if (cell == null) {
      return null;
    }
    String raw = formatter.formatCellValue(cell);
    return raw == null ? null : raw.trim();
  }

  private static boolean isBlank(String s) {
    return s == null || s.isBlank();
  }

  private static String normalize(String s) {
    return isBlank(s) ? null : s.trim().toLowerCase(Locale.ROOT);
  }

  private static String normalizeHeader(String s) {
    return s.trim().toLowerCase(Locale.ROOT);
  }
}
