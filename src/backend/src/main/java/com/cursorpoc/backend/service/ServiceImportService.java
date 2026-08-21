package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.ServiceCategory;
import com.cursorpoc.backend.domain.Tax;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.excelimport.ExcelHeaderValidationService;
import com.cursorpoc.backend.excelimport.HeaderValidationResult;
import com.cursorpoc.backend.excelimport.ImportEntityType;
import com.cursorpoc.backend.excelimport.ImportResult;
import com.cursorpoc.backend.excelimport.ImportRowOutcome;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.repository.ServiceCategoryRepository;
import com.cursorpoc.backend.repository.TaxRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import java.io.ByteArrayInputStream;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellType;
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
 * HU-51 (Épica E — Importación de datos vía Excel): parses the data rows of a servicios import file
 * (already header-validated by {@link ExcelHeaderValidationService}, HU-50 AC-5/AC-6) and persists
 * every valid row as a {@code SalonService} for the target tenant. Per the PRD ("transaccional por
 * archivo: si una fila falla, las filas válidas igual se importan") each row is validated and
 * persisted independently — one bad row never rolls back or blocks the rest of the file.
 *
 * <ul>
 *   <li>AC-2: a {@code categoria} that doesn't exist yet in the tenant is created automatically
 *       before the service that references it.
 *   <li>AC-3: non-numeric/negative/zero {@code precio}, or non-numeric/&lt;1-minute {@code
 *       duracion_minutos}, rejects only that row.
 *   <li>AC-4: a non-blank {@code impuesto} that doesn't match an existing tenant {@code Tax} by
 *       name rejects the row with a clear reason; a blank {@code impuesto} creates the service
 *       untaxed.
 *   <li>AC-5: two rows in the same file with the same {@code nombre} + {@code categoria}
 *       (case/space insensitive) — only the first is considered for import; the second (and any
 *       further repeat) is reported as a duplicate, even if the first itself later fails another
 *       rule.
 *   <li>AC-7: every created {@code SalonService} is scoped to the target tenant only.
 * </ul>
 */
@Service
public class ServiceImportService {

  private static final Logger log = LoggerFactory.getLogger(ServiceImportService.class);

  public static final String ERROR_NAME_REQUIRED = "IMPORT_ROW_NAME_REQUIRED";
  public static final String ERROR_CATEGORY_REQUIRED = "IMPORT_ROW_CATEGORY_REQUIRED";
  public static final String ERROR_DUPLICATE_ROW = "IMPORT_ROW_DUPLICATE";
  public static final String ERROR_PRICE_NOT_NUMERIC = "IMPORT_ROW_PRICE_NOT_NUMERIC";
  public static final String ERROR_PRICE_INVALID = "IMPORT_ROW_PRICE_INVALID";
  public static final String ERROR_DURATION_NOT_NUMERIC = "IMPORT_ROW_DURATION_NOT_NUMERIC";
  public static final String ERROR_DURATION_INVALID = "IMPORT_ROW_DURATION_INVALID";
  public static final String ERROR_TAX_NOT_FOUND = "IMPORT_ROW_TAX_NOT_FOUND";
  public static final String ERROR_ROW_FAILED = "IMPORT_ROW_FAILED";

  private static final String COL_CATEGORIA = "categoria";
  private static final String COL_NOMBRE = "nombre";
  private static final String COL_PRECIO = "precio";
  private static final String COL_DURACION = "duracion_minutos";
  private static final String COL_IMPUESTO = "impuesto";
  private static final String COL_ACTIVO = "activo";

  private final TenantRepository tenantRepository;
  private final ServiceCategoryRepository serviceCategoryRepository;
  private final SalonServiceRepository salonServiceRepository;
  private final TaxRepository taxRepository;
  private final ExcelHeaderValidationService headerValidationService;

  public ServiceImportService(
      TenantRepository tenantRepository,
      ServiceCategoryRepository serviceCategoryRepository,
      SalonServiceRepository salonServiceRepository,
      TaxRepository taxRepository,
      ExcelHeaderValidationService headerValidationService) {
    this.tenantRepository = tenantRepository;
    this.serviceCategoryRepository = serviceCategoryRepository;
    this.salonServiceRepository = salonServiceRepository;
    this.taxRepository = taxRepository;
    this.headerValidationService = headerValidationService;
  }

  @Transactional
  public ImportResult importServices(long tenantId, byte[] fileBytes) {
    Tenant tenant =
        tenantRepository
            .findById(tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND"));

    HeaderValidationResult headerResult =
        headerValidationService.validateHeaders(fileBytes, ImportEntityType.SERVICES);
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

      Map<String, ServiceCategory> categoryByName = new HashMap<>();
      for (ServiceCategory c : serviceCategoryRepository.findByTenant_IdOrderByNameAsc(tenantId)) {
        categoryByName.put(normalize(c.getName()), c);
      }
      Map<String, Tax> taxByName = new HashMap<>();
      for (Tax tax : taxRepository.findByTenant_IdOrderByNameAsc(tenantId)) {
        taxByName.put(normalize(tax.getName()), tax);
      }

      Set<String> seenKeys = new HashSet<>();
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
                  categoryByName,
                  taxByName,
                  seenKeys));
        } catch (Exception ex) {
          log.error(
              "importServices tenantId={} row={} status=REJECTED error={}",
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
      log.error("importServices tenantId={} status=REJECTED error=CORRUPT_FILE", tenantId, ex);
      return ImportResult.fileError("CORRUPT_FILE");
    }
  }

  private ImportRowOutcome processRow(
      Tenant tenant,
      Row row,
      int excelRowNumber,
      Map<String, Integer> headerIndex,
      DataFormatter formatter,
      Map<String, ServiceCategory> categoryByName,
      Map<String, Tax> taxByName,
      Set<String> seenKeys) {
    String categoria = textValue(row, headerIndex.get(COL_CATEGORIA), formatter);
    String nombre = textValue(row, headerIndex.get(COL_NOMBRE), formatter);
    String impuesto = textValue(row, headerIndex.get(COL_IMPUESTO), formatter);
    String activo = textValue(row, headerIndex.get(COL_ACTIVO), formatter);

    if (isBlank(nombre)) {
      return ImportRowOutcome.rejected(excelRowNumber, ERROR_NAME_REQUIRED, null);
    }
    if (isBlank(categoria)) {
      return ImportRowOutcome.rejected(excelRowNumber, ERROR_CATEGORY_REQUIRED, nombre.trim());
    }

    String dedupeKey = normalize(categoria) + "|" + normalize(nombre);
    if (!seenKeys.add(dedupeKey)) {
      return ImportRowOutcome.rejected(excelRowNumber, ERROR_DUPLICATE_ROW, nombre.trim());
    }

    NumericCellValue priceValue = numericValue(row, headerIndex.get(COL_PRECIO), formatter);
    if (priceValue.blankOrInvalid()) {
      return ImportRowOutcome.rejected(excelRowNumber, ERROR_PRICE_NOT_NUMERIC, nombre.trim());
    }
    BigDecimal priceMinor = priceValue.value();
    if (priceMinor.compareTo(BigDecimal.ZERO) <= 0) {
      return ImportRowOutcome.rejected(excelRowNumber, ERROR_PRICE_INVALID, nombre.trim());
    }

    NumericCellValue durationValue = numericValue(row, headerIndex.get(COL_DURACION), formatter);
    if (durationValue.blankOrInvalid()) {
      return ImportRowOutcome.rejected(excelRowNumber, ERROR_DURATION_NOT_NUMERIC, nombre.trim());
    }
    int durationMinutes = durationValue.value().intValue();
    if (durationMinutes < 1) {
      return ImportRowOutcome.rejected(excelRowNumber, ERROR_DURATION_INVALID, nombre.trim());
    }

    Tax tax = null;
    if (!isBlank(impuesto)) {
      tax = taxByName.get(normalize(impuesto));
      if (tax == null) {
        return ImportRowOutcome.rejected(excelRowNumber, ERROR_TAX_NOT_FOUND, nombre.trim());
      }
    }

    ServiceCategory category = categoryByName.get(normalize(categoria));
    if (category == null) {
      category = new ServiceCategory();
      category.setTenant(tenant);
      category.setName(categoria.trim());
      category.setActive(true);
      category.setAccentKey("stone");
      serviceCategoryRepository.save(category);
      categoryByName.put(normalize(categoria), category);
    }

    boolean active = !"NO".equalsIgnoreCase(activo == null ? "" : activo.trim());

    SalonService service = new SalonService();
    service.setTenant(tenant);
    service.setCategory(category);
    service.setTax(tax);
    service.setName(nombre.trim());
    service.setPriceMinor(priceMinor);
    service.setDurationMinutes(durationMinutes);
    service.setActive(active);
    salonServiceRepository.save(service);

    return ImportRowOutcome.imported(excelRowNumber, nombre.trim());
  }

  private static Map<String, Integer> buildHeaderIndex(Row headerRow) {
    Map<String, Integer> map = new HashMap<>();
    DataFormatter formatter = new DataFormatter();
    for (Cell cell : headerRow) {
      String raw = formatter.formatCellValue(cell);
      if (raw != null && !raw.isBlank()) {
        map.putIfAbsent(normalize(raw), cell.getColumnIndex());
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

  /** AC-3: reads a numeric column tolerant of a numeric cell OR digits-with-dot-separators text. */
  private static NumericCellValue numericValue(Row row, Integer colIndex, DataFormatter formatter) {
    if (colIndex == null) {
      return NumericCellValue.invalid();
    }
    Cell cell = row.getCell(colIndex);
    if (cell == null) {
      return NumericCellValue.invalid();
    }
    if (cell.getCellType() == CellType.NUMERIC) {
      return NumericCellValue.of(BigDecimal.valueOf(cell.getNumericCellValue()));
    }
    String raw = formatter.formatCellValue(cell);
    if (raw == null || raw.isBlank()) {
      return NumericCellValue.invalid();
    }
    // Guaraníes convention (PRD "Moneda"): thousands separated by ".", no decimals.
    String cleaned = raw.trim().replace(".", "").replace(" ", "");
    if (!cleaned.matches("-?\\d+")) {
      return NumericCellValue.invalid();
    }
    return NumericCellValue.of(new BigDecimal(cleaned));
  }

  private static boolean isBlank(String s) {
    return s == null || s.isBlank();
  }

  private static String normalize(String s) {
    return s.trim().toLowerCase(Locale.ROOT);
  }

  private record NumericCellValue(boolean valid, BigDecimal value) {
    static NumericCellValue of(BigDecimal value) {
      return new NumericCellValue(true, value);
    }

    static NumericCellValue invalid() {
      return new NumericCellValue(false, null);
    }

    boolean blankOrInvalid() {
      return !valid;
    }
  }
}
