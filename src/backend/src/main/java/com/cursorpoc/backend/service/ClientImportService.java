package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.excelimport.ExcelHeaderValidationService;
import com.cursorpoc.backend.excelimport.HeaderValidationResult;
import com.cursorpoc.backend.excelimport.ImportEntityType;
import com.cursorpoc.backend.excelimport.ImportResult;
import com.cursorpoc.backend.excelimport.ImportRowOutcome;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.util.ParaguayRucValidator;
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
 * HU-52 (Épica E — Importación de datos vía Excel): parses the data rows of a clientes import file
 * (already header-validated by {@link ExcelHeaderValidationService}, HU-50 AC-5/AC-6) and persists
 * every valid row as a {@code Client} for the target tenant. Per the PRD ("transaccional por
 * archivo: si una fila falla, las filas válidas igual se importan") each row is validated and
 * persisted independently — one bad row never rolls back or blocks the rest of the file.
 *
 * <ul>
 *   <li>AC-2: a blank {@code nombre_completo} rejects only that row.
 *   <li>AC-3: the same per-tenant uniqueness rules manual client creation enforces ({@link
 *       ClientService#create}) — a non-blank {@code telefono}/{@code email}/{@code ruc} that
 *       duplicates either an existing client of the tenant or an earlier row of the same file
 *       rejects that row. Per the PRD's cross-cutting rule, blank values never collide.
 *   <li>AC-4: a non-blank {@code ruc} is validated with the same {@link ParaguayRucValidator} used
 *       by manual client creation; an invalid RUC rejects only that row.
 *   <li>AC-5: only {@code nombre_completo} is required — every other column may be left blank.
 *   <li>AC-6: every created {@code Client} is scoped to the target tenant only, so the same
 *       telefono/email/ruc in a different tenant never collides with this import.
 * </ul>
 */
@Service
public class ClientImportService {

  private static final Logger log = LoggerFactory.getLogger(ClientImportService.class);

  public static final String ERROR_FULL_NAME_REQUIRED = "IMPORT_ROW_FULL_NAME_REQUIRED";
  public static final String ERROR_RUC_INVALID = "IMPORT_ROW_RUC_INVALID";
  public static final String ERROR_PHONE_DUPLICATE = "IMPORT_ROW_PHONE_DUPLICATE";
  public static final String ERROR_EMAIL_DUPLICATE = "IMPORT_ROW_EMAIL_DUPLICATE";
  public static final String ERROR_RUC_DUPLICATE = "IMPORT_ROW_RUC_DUPLICATE";
  public static final String ERROR_ROW_FAILED = "IMPORT_ROW_FAILED";

  private static final String COL_NOMBRE_COMPLETO = "nombre_completo";
  private static final String COL_TELEFONO = "telefono";
  private static final String COL_EMAIL = "email";
  private static final String COL_RUC = "ruc";
  private static final String COL_DOCUMENTO_IDENTIDAD = "documento_identidad";
  private static final String COL_DIRECCION = "direccion";
  private static final String COL_ACTIVO = "activo";

  private final TenantRepository tenantRepository;
  private final ClientRepository clientRepository;
  private final ExcelHeaderValidationService headerValidationService;

  public ClientImportService(
      TenantRepository tenantRepository,
      ClientRepository clientRepository,
      ExcelHeaderValidationService headerValidationService) {
    this.tenantRepository = tenantRepository;
    this.clientRepository = clientRepository;
    this.headerValidationService = headerValidationService;
  }

  @Transactional
  public ImportResult importClients(long tenantId, byte[] fileBytes) {
    Tenant tenant =
        tenantRepository
            .findById(tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND"));

    HeaderValidationResult headerResult =
        headerValidationService.validateHeaders(fileBytes, ImportEntityType.CLIENTS);
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

      // AC-3/AC-6: existing clients of THIS tenant only — a different tenant's matching
      // telefono/email/ruc never counts as a duplicate.
      Set<String> seenPhones = new HashSet<>();
      Set<String> seenEmails = new HashSet<>();
      Set<String> seenRucs = new HashSet<>();
      for (Client existing : clientRepository.findByTenant_Id(tenantId)) {
        addIfPresent(seenPhones, digitsOnly(existing.getPhone()));
        addIfPresent(seenEmails, normalize(existing.getEmail()));
        addIfPresent(seenRucs, existing.getRuc() == null ? null : existing.getRuc().trim());
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
          outcomes.add(
              processRow(
                  tenant,
                  row,
                  excelRowNumber,
                  headerIndex,
                  formatter,
                  seenPhones,
                  seenEmails,
                  seenRucs));
        } catch (Exception ex) {
          log.error(
              "importClients tenantId={} row={} status=REJECTED error={}",
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
      log.error("importClients tenantId={} status=REJECTED error=CORRUPT_FILE", tenantId, ex);
      return ImportResult.fileError("CORRUPT_FILE");
    }
  }

  private ImportRowOutcome processRow(
      Tenant tenant,
      Row row,
      int excelRowNumber,
      Map<String, Integer> headerIndex,
      DataFormatter formatter,
      Set<String> seenPhones,
      Set<String> seenEmails,
      Set<String> seenRucs) {
    String nombreCompleto = textValue(row, headerIndex.get(COL_NOMBRE_COMPLETO), formatter);
    String telefono = textValue(row, headerIndex.get(COL_TELEFONO), formatter);
    String email = textValue(row, headerIndex.get(COL_EMAIL), formatter);
    String ruc = textValue(row, headerIndex.get(COL_RUC), formatter);
    String documentoIdentidad = textValue(row, headerIndex.get(COL_DOCUMENTO_IDENTIDAD), formatter);
    String direccion = textValue(row, headerIndex.get(COL_DIRECCION), formatter);
    String activo = textValue(row, headerIndex.get(COL_ACTIVO), formatter);

    if (isBlank(nombreCompleto)) {
      return ImportRowOutcome.rejected(excelRowNumber, ERROR_FULL_NAME_REQUIRED, null);
    }
    String fullName = nombreCompleto.trim();

    String normalizedRuc = isBlank(ruc) ? null : ruc.trim();
    if (normalizedRuc != null && !ParaguayRucValidator.isValid(normalizedRuc)) {
      return ImportRowOutcome.rejected(excelRowNumber, ERROR_RUC_INVALID, fullName);
    }

    String phoneKey = digitsOnly(telefono);
    if (phoneKey != null && seenPhones.contains(phoneKey)) {
      return ImportRowOutcome.rejected(excelRowNumber, ERROR_PHONE_DUPLICATE, fullName);
    }
    String emailKey = normalize(email);
    if (emailKey != null && seenEmails.contains(emailKey)) {
      return ImportRowOutcome.rejected(excelRowNumber, ERROR_EMAIL_DUPLICATE, fullName);
    }
    if (normalizedRuc != null && seenRucs.contains(normalizedRuc)) {
      return ImportRowOutcome.rejected(excelRowNumber, ERROR_RUC_DUPLICATE, fullName);
    }

    boolean active = !"NO".equalsIgnoreCase(activo == null ? "" : activo.trim());

    Client client = new Client();
    client.setTenant(tenant);
    client.setFullName(fullName.toUpperCase(Locale.ROOT));
    client.setPhone(isBlank(telefono) ? null : telefono.trim());
    client.setEmail(isBlank(email) ? null : email.trim());
    client.setRuc(normalizedRuc);
    client.setIdentityDocumentNumber(
        isBlank(documentoIdentidad) ? null : documentoIdentidad.trim());
    client.setAddress(isBlank(direccion) ? null : direccion.trim());
    client.setActive(active);
    client.setVisitCount(0);
    clientRepository.save(client);

    addIfPresent(seenPhones, phoneKey);
    addIfPresent(seenEmails, emailKey);
    addIfPresent(seenRucs, normalizedRuc);

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

  /**
   * Digits-only phone comparison, matching {@code ClientService#phoneDuplicateExists} — clients may
   * be created with formatted numbers (e.g. "(0981) 123-456") or raw digits, and both represent the
   * same phone number.
   */
  private static String digitsOnly(String value) {
    if (value == null) return null;
    String digits = value.replaceAll("\\D+", "");
    return digits.isEmpty() ? null : digits;
  }

  private static String normalize(String s) {
    return isBlank(s) ? null : s.trim().toLowerCase(Locale.ROOT);
  }

  private static String normalizeHeader(String s) {
    return s.trim().toLowerCase(Locale.ROOT);
  }
}
