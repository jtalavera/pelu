package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.cursorpoc.backend.domain.ServiceCategory;
import com.cursorpoc.backend.domain.Tax;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.excelimport.ExcelHeaderValidationService;
import com.cursorpoc.backend.excelimport.ImportColumnTemplateRegistry;
import com.cursorpoc.backend.excelimport.ImportResult;
import com.cursorpoc.backend.excelimport.ImportRowOutcome;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.repository.ServiceCategoryRepository;
import com.cursorpoc.backend.repository.TaxRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import java.io.ByteArrayOutputStream;
import java.util.List;
import java.util.Optional;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-51: the actual upload -> parse data rows -> validate row-by-row -> persist flow for
 * "servicios", built on top of HU-50's header validation.
 */
@ExtendWith(MockitoExtension.class)
class ServiceImportServiceTest {

  @Mock private TenantRepository tenantRepository;
  @Mock private ServiceCategoryRepository serviceCategoryRepository;
  @Mock private SalonServiceRepository salonServiceRepository;
  @Mock private TaxRepository taxRepository;

  private ServiceImportService service;

  private Tenant tenant;

  @BeforeEach
  void setUp() {
    ExcelHeaderValidationService headerValidationService =
        new ExcelHeaderValidationService(new ImportColumnTemplateRegistry());
    service =
        new ServiceImportService(
            tenantRepository,
            serviceCategoryRepository,
            salonServiceRepository,
            taxRepository,
            headerValidationService);

    tenant = new Tenant();
    tenant.setId(1L);
    tenant.setName("Demo");
    lenient().when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    lenient()
        .when(serviceCategoryRepository.findByTenant_IdOrderByNameAsc(1L))
        .thenReturn(List.of());
    lenient().when(taxRepository.findByTenant_IdOrderByNameAsc(1L)).thenReturn(List.of());
  }

  private static byte[] workbook(String[] headers, String[]... dataRows) {
    try (XSSFWorkbook workbook = new XSSFWorkbook();
        ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      Sheet sheet = workbook.createSheet("Sheet1");
      Row headerRow = sheet.createRow(0);
      for (int i = 0; i < headers.length; i++) {
        headerRow.createCell(i).setCellValue(headers[i]);
      }
      for (int r = 0; r < dataRows.length; r++) {
        Row row = sheet.createRow(r + 1);
        String[] values = dataRows[r];
        for (int i = 0; i < values.length; i++) {
          if (values[i] != null) {
            row.createCell(i).setCellValue(values[i]);
          }
        }
      }
      workbook.write(out);
      return out.toByteArray();
    } catch (Exception e) {
      throw new RuntimeException(e);
    }
  }

  private static final String[] SERVICE_HEADERS = {
    "categoria", "nombre", "precio", "duracion_minutos", "impuesto", "activo"
  };

  // AC-2: a category that doesn't exist yet in the tenant is created automatically.
  @Test
  void missingCategory_isCreatedAutomaticallyBeforeTheService() {
    byte[] bytes =
        workbook(SERVICE_HEADERS, new String[] {"Corte", "Corte de dama", "150000", "45"});
    ImportResult result = service.importServices(1L, bytes);

    assertThat(result.fileAccepted()).isTrue();
    assertThat(result.importedCount()).isEqualTo(1);
    assertThat(result.failedCount()).isEqualTo(0);
    verify(serviceCategoryRepository)
        .save(
            org.mockito.ArgumentMatchers.argThat(
                (ServiceCategory c) -> c.getName().equals("Corte") && c.isActive()));
    verify(salonServiceRepository).save(any());
  }

  // Servicios file holds only services: a legacy tipo/sku column is ignored, every row is SERVICE.
  @Test
  void servicesFile_alwaysCreatesServices_ignoringLegacyTipoAndSkuColumns() {
    String[] headers = {
      "categoria", "nombre", "precio", "duracion_minutos", "impuesto", "activo", "tipo", "sku"
    };
    byte[] bytes =
        workbook(
            headers,
            new String[] {"Cortes", "Corte", "80000", "30", "", "SI", "Producto", "SH-300"},
            new String[] {"Cortes", "Brushing", "60000", "30", "", "SI", "", ""});

    ImportResult result = service.importServices(1L, bytes);

    assertThat(result.importedCount()).isEqualTo(2);
    org.mockito.ArgumentCaptor<com.cursorpoc.backend.domain.SalonService> saved =
        org.mockito.ArgumentCaptor.forClass(com.cursorpoc.backend.domain.SalonService.class);
    verify(salonServiceRepository, org.mockito.Mockito.times(2)).save(saved.capture());
    assertThat(saved.getAllValues())
        .extracting(
            com.cursorpoc.backend.domain.SalonService::getKind,
            com.cursorpoc.backend.domain.SalonService::getSku)
        .containsExactly(
            org.assertj.core.groups.Tuple.tuple(
                com.cursorpoc.backend.domain.enums.ServiceKind.SERVICE, null),
            org.assertj.core.groups.Tuple.tuple(
                com.cursorpoc.backend.domain.enums.ServiceKind.SERVICE, null));
    verify(serviceCategoryRepository)
        .save(
            org.mockito.ArgumentMatchers.argThat(
                (ServiceCategory c) ->
                    c.getName().equals("Cortes")
                        && c.getKind() == com.cursorpoc.backend.domain.enums.ServiceKind.SERVICE));
  }

  // Catalog split: a servicios row pointing at an existing product category is rejected.
  @Test
  void servicesFile_rowInAProductCategory_isRejectedWithKindMismatch() {
    ServiceCategory shampoos = new ServiceCategory();
    shampoos.setName("Shampoos");
    shampoos.setKind(com.cursorpoc.backend.domain.enums.ServiceKind.PRODUCT);
    org.mockito.Mockito.when(serviceCategoryRepository.findByTenant_IdOrderByNameAsc(1L))
        .thenReturn(List.of(shampoos));
    byte[] bytes =
        workbook(
            SERVICE_HEADERS,
            new String[] {"Shampoos", "Lavado", "30000", "15"},
            new String[] {"Cortes", "Corte", "80000", "30"});

    ImportResult result = service.importServices(1L, bytes);

    assertThat(result.importedCount()).isEqualTo(1);
    assertThat(result.failedCount()).isEqualTo(1);
    assertThat(result.rows())
        .anySatisfy(
            r ->
                assertThat(r.errorCode())
                    .isEqualTo(ServiceImportService.ERROR_CATEGORY_KIND_MISMATCH));
  }

  // AC-3: non-numeric price rejects only that row.
  @Test
  void nonNumericPrice_rejectsOnlyThatRow() {
    byte[] bytes =
        workbook(SERVICE_HEADERS, new String[] {"Corte", "Corte de dama", "no-es-numero", "45"});
    ImportResult result = service.importServices(1L, bytes);

    assertThat(result.totalRows()).isEqualTo(1);
    assertThat(result.importedCount()).isEqualTo(0);
    assertThat(result.failedCount()).isEqualTo(1);
    assertThat(result.rows().get(0).errorCode())
        .isEqualTo(ServiceImportService.ERROR_PRICE_NOT_NUMERIC);
    verify(salonServiceRepository, never()).save(any());
  }

  // AC-3: a negative price rejects the row.
  @Test
  void negativePrice_isRejected() {
    byte[] bytes = workbook(SERVICE_HEADERS, new String[] {"Corte", "Otro corte", "-100", "45"});
    ImportResult result = service.importServices(1L, bytes);

    assertThat(result.failedCount()).isEqualTo(1);
    assertThat(result.rows().get(0).errorCode())
        .isEqualTo(ServiceImportService.ERROR_PRICE_INVALID);
    verify(salonServiceRepository, never()).save(any());
  }

  // A zero price is allowed (no "greater than zero" rule), same as the manual catalog screens.
  @Test
  void zeroPrice_isImported() {
    byte[] bytes =
        workbook(SERVICE_HEADERS, new String[] {"Corte", "Corte de cortesia", "0", "45"});
    ImportResult result = service.importServices(1L, bytes);

    assertThat(result.importedCount()).isEqualTo(1);
    assertThat(result.failedCount()).isEqualTo(0);
    verify(salonServiceRepository).save(any());
  }

  // AC-3: non-numeric or <1-minute duration rejects only that row.
  @Test
  void invalidDuration_rejectsOnlyThatRow() {
    byte[] bytes =
        workbook(
            SERVICE_HEADERS,
            new String[] {"Corte", "Corte de dama", "150000", "0"},
            new String[] {"Corte", "Otro corte", "150000", "abc"});
    ImportResult result = service.importServices(1L, bytes);

    assertThat(result.failedCount()).isEqualTo(2);
    assertThat(result.rows().get(0).errorCode())
        .isEqualTo(ServiceImportService.ERROR_DURATION_INVALID);
    assertThat(result.rows().get(1).errorCode())
        .isEqualTo(ServiceImportService.ERROR_DURATION_NOT_NUMERIC);
  }

  // Rows that pass validation still import even when other rows in the same file fail (per-row
  // independence, PRD "transaccional por archivo").
  @Test
  void invalidRowDoesNotBlockOtherValidRowsInTheSameFile() {
    byte[] bytes =
        workbook(
            SERVICE_HEADERS,
            new String[] {"Corte", "Corte de dama", "no-numero", "45"},
            new String[] {"Corte", "Otro corte", "150000", "45"});
    ImportResult result = service.importServices(1L, bytes);

    assertThat(result.totalRows()).isEqualTo(2);
    assertThat(result.importedCount()).isEqualTo(1);
    assertThat(result.failedCount()).isEqualTo(1);
  }

  // AC-4: impuesto referencing a tax that doesn't exist in the tenant rejects the row.
  @Test
  void unknownTax_rejectsTheRow() {
    byte[] bytes =
        workbook(
            SERVICE_HEADERS, new String[] {"Corte", "Corte de dama", "150000", "45", "IVA 10%"});
    ImportResult result = service.importServices(1L, bytes);

    assertThat(result.failedCount()).isEqualTo(1);
    assertThat(result.rows().get(0).errorCode())
        .isEqualTo(ServiceImportService.ERROR_TAX_NOT_FOUND);
    verify(salonServiceRepository, never()).save(any());
  }

  // AC-4: blank impuesto creates the service with no tax.
  @Test
  void blankTax_createsServiceWithNoTax() {
    byte[] bytes =
        workbook(SERVICE_HEADERS, new String[] {"Corte", "Corte de dama", "150000", "45"});
    ImportResult result = service.importServices(1L, bytes);

    assertThat(result.importedCount()).isEqualTo(1);
    verify(salonServiceRepository)
        .save(org.mockito.ArgumentMatchers.argThat(s -> s.getTax() == null));
  }

  // AC-4: an existing tax matched by name (case-insensitive) is associated with the service.
  @Test
  void existingTax_isAssociatedWithTheService() {
    Tax iva = new Tax();
    iva.setId(5L);
    iva.setTenant(tenant);
    iva.setName("IVA 10%");
    lenient().when(taxRepository.findByTenant_IdOrderByNameAsc(1L)).thenReturn(List.of(iva));

    byte[] bytes =
        workbook(
            SERVICE_HEADERS, new String[] {"Corte", "Corte de dama", "150000", "45", "iva 10%"});
    ImportResult result = service.importServices(1L, bytes);

    assertThat(result.importedCount()).isEqualTo(1);
    verify(salonServiceRepository)
        .save(org.mockito.ArgumentMatchers.argThat(s -> s.getTax() == iva));
  }

  // AC-5: two rows with the same nombre+categoria in the same file — only the first is considered
  // for import, the second is reported as a duplicate.
  @Test
  void duplicateNameAndCategoryInSameFile_onlyFirstIsImported() {
    byte[] bytes =
        workbook(
            SERVICE_HEADERS,
            new String[] {"Corte", "Corte de dama", "150000", "45"},
            new String[] {"corte", "  corte DE dama  ", "200000", "30"});
    ImportResult result = service.importServices(1L, bytes);

    assertThat(result.totalRows()).isEqualTo(2);
    assertThat(result.importedCount()).isEqualTo(1);
    assertThat(result.failedCount()).isEqualTo(1);
    assertThat(result.rows().get(1).errorCode())
        .isEqualTo(ServiceImportService.ERROR_DUPLICATE_ROW);
    verify(salonServiceRepository, org.mockito.Mockito.times(1)).save(any());
  }

  // AC-7: every created service is tied to the target tenant.
  @Test
  void createdServices_areScopedToTheTargetTenant() {
    byte[] bytes =
        workbook(SERVICE_HEADERS, new String[] {"Corte", "Corte de dama", "150000", "45"});
    service.importServices(1L, bytes);

    verify(salonServiceRepository)
        .save(org.mockito.ArgumentMatchers.argThat(s -> s.getTenant() == tenant));
  }

  // Blank name / blank category are rejected individually with a specific reason.
  @Test
  void blankNameOrCategory_areRejectedIndividually() {
    byte[] bytes =
        workbook(
            SERVICE_HEADERS,
            new String[] {"Corte", "", "150000", "45"},
            new String[] {"", "Corte de dama 2", "150000", "45"});
    ImportResult result = service.importServices(1L, bytes);

    assertThat(result.failedCount()).isEqualTo(2);
    assertThat(result.rows().get(0).errorCode())
        .isEqualTo(ServiceImportService.ERROR_NAME_REQUIRED);
    assertThat(result.rows().get(1).errorCode())
        .isEqualTo(ServiceImportService.ERROR_CATEGORY_REQUIRED);
  }

  // A price formatted with Guaraníes-style dot thousands separators (e.g. "150.000") is accepted.
  @Test
  void priceWithDotThousandsSeparator_isAccepted() {
    byte[] bytes =
        workbook(SERVICE_HEADERS, new String[] {"Corte", "Corte de dama", "150.000", "45"});
    ImportResult result = service.importServices(1L, bytes);

    assertThat(result.importedCount()).isEqualTo(1);
    verify(salonServiceRepository)
        .save(
            org.mockito.ArgumentMatchers.argThat(
                s -> s.getPriceMinor().compareTo(new java.math.BigDecimal("150000")) == 0));
  }

  // "activo" defaults to true (SI) when blank, and false only when explicitly "NO".
  @Test
  void activo_defaultsToTrueAndRespectsExplicitNo() {
    byte[] bytes =
        workbook(
            SERVICE_HEADERS,
            new String[] {"Corte", "Corte de dama", "150000", "45", null, ""},
            new String[] {"Corte", "Corte de caballero", "150000", "45", null, "NO"});
    ImportResult result = service.importServices(1L, bytes);

    assertThat(result.importedCount()).isEqualTo(2);
    verify(salonServiceRepository).save(org.mockito.ArgumentMatchers.argThat(s -> s.isActive()));
    verify(salonServiceRepository).save(org.mockito.ArgumentMatchers.argThat(s -> !s.isActive()));
  }

  // HU-50 AC-5: a missing required column rejects the whole file before any row is processed.
  @Test
  void missingRequiredColumn_rejectsWholeFileBeforeAnyRowIsProcessed() {
    byte[] bytes = workbook(new String[] {"categoria", "nombre", "duracion_minutos"});
    ImportResult result = service.importServices(1L, bytes);

    assertThat(result.fileAccepted()).isFalse();
    assertThat(result.missingRequiredColumns()).containsExactly("precio");
    assertThat(result.totalRows()).isEqualTo(0);
    verify(salonServiceRepository, never()).save(any());
  }

  // A tenant that does not exist is rejected outright, before any row processing.
  @Test
  void unknownTenant_throwsNotFound() {
    byte[] bytes =
        workbook(SERVICE_HEADERS, new String[] {"Corte", "Corte de dama", "150000", "45"});
    assertThatThrownBy(() -> service.importServices(999L, bytes))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("TENANT_NOT_FOUND");
  }

  // An entirely blank trailing row is skipped, not counted or reported as a failure.
  @Test
  void blankTrailingRow_isSkipped() {
    byte[] bytes =
        workbook(
            SERVICE_HEADERS,
            new String[] {"Corte", "Corte de dama", "150000", "45"},
            new String[] {null, null, null, null});
    ImportResult result = service.importServices(1L, bytes);

    assertThat(result.totalRows()).isEqualTo(1);
    assertThat(result.importedCount()).isEqualTo(1);
  }

  // Verifies imported row outcomes carry the readable name for a compact result summary.
  @Test
  void importedRowOutcome_carriesTheServiceName() {
    byte[] bytes =
        workbook(SERVICE_HEADERS, new String[] {"Corte", "Corte de dama", "150000", "45"});
    ImportResult result = service.importServices(1L, bytes);

    ImportRowOutcome outcome = result.rows().get(0);
    assertThat(outcome.imported()).isTrue();
    assertThat(outcome.name()).isEqualTo("Corte de dama");
    assertThat(outcome.rowNumber()).isEqualTo(2);
  }

  // Productos file: no duracion_minutos column; every row is a Producto with duration 1. No
  // automatic Stock sync (the service has no event publisher at all).
  @Test
  void productsFile_createsProductsWithMinimumDuration() {
    String[] headers = {"categoria", "nombre", "precio", "impuesto", "activo", "sku"};
    byte[] bytes =
        workbook(
            headers,
            new String[] {"Cuidado capilar", "Shampoo", "95000", "", "SI", "SH-300"},
            new String[] {"Cuidado capilar", "Acondicionador", "85000", "", "NO", ""});

    ImportResult result = service.importProducts(1L, bytes);

    assertThat(result.fileAccepted()).isTrue();
    assertThat(result.importedCount()).isEqualTo(2);
    org.mockito.ArgumentCaptor<com.cursorpoc.backend.domain.SalonService> saved =
        org.mockito.ArgumentCaptor.forClass(com.cursorpoc.backend.domain.SalonService.class);
    verify(salonServiceRepository, org.mockito.Mockito.times(2)).save(saved.capture());
    assertThat(saved.getAllValues())
        .extracting(
            com.cursorpoc.backend.domain.SalonService::getKind,
            com.cursorpoc.backend.domain.SalonService::getDurationMinutes,
            com.cursorpoc.backend.domain.SalonService::getSku,
            com.cursorpoc.backend.domain.SalonService::isActive)
        .containsExactly(
            org.assertj.core.groups.Tuple.tuple(
                com.cursorpoc.backend.domain.enums.ServiceKind.PRODUCT, 1, "SH-300", true),
            org.assertj.core.groups.Tuple.tuple(
                com.cursorpoc.backend.domain.enums.ServiceKind.PRODUCT, 1, null, false));
    verify(serviceCategoryRepository)
        .save(
            org.mockito.ArgumentMatchers.argThat(
                (ServiceCategory c) ->
                    c.getName().equals("Cuidado capilar")
                        && c.getKind() == com.cursorpoc.backend.domain.enums.ServiceKind.PRODUCT));
  }

  @Test
  void productsFile_rowInAServiceCategory_isRejectedWithKindMismatch() {
    ServiceCategory cortes = new ServiceCategory();
    cortes.setName("Cortes");
    cortes.setKind(com.cursorpoc.backend.domain.enums.ServiceKind.SERVICE);
    org.mockito.Mockito.when(serviceCategoryRepository.findByTenant_IdOrderByNameAsc(1L))
        .thenReturn(List.of(cortes));
    String[] headers = {"categoria", "nombre", "precio"};
    byte[] bytes = workbook(headers, new String[] {"Cortes", "Shampoo", "95000"});

    ImportResult result = service.importProducts(1L, bytes);

    assertThat(result.importedCount()).isZero();
    assertThat(result.rows())
        .singleElement()
        .satisfies(
            r ->
                assertThat(r.errorCode())
                    .isEqualTo(ServiceImportService.ERROR_CATEGORY_KIND_MISMATCH));
    verify(salonServiceRepository, never()).save(any());
  }

  // Productos file: a zero price is allowed, a negative one is still rejected.
  @Test
  void productsFile_zeroPriceIsImported_negativePriceIsRejected() {
    String[] headers = {"categoria", "nombre", "precio"};
    byte[] bytes =
        workbook(
            headers,
            new String[] {"Muestras", "Muestra gratis", "0"},
            new String[] {"Muestras", "Precio negativo", "-1"});

    ImportResult result = service.importProducts(1L, bytes);

    assertThat(result.importedCount()).isEqualTo(1);
    assertThat(result.failedCount()).isEqualTo(1);
    assertThat(result.rows().get(1).errorCode())
        .isEqualTo(ServiceImportService.ERROR_PRICE_INVALID);
  }

  @Test
  void productsFile_missingRequiredColumn_isRejectedWithMissingList() {
    byte[] bytes = workbook(new String[] {"categoria", "nombre"}, new String[] {"X", "Y"});

    ImportResult result = service.importProducts(1L, bytes);

    assertThat(result.fileAccepted()).isFalse();
    assertThat(result.missingRequiredColumns()).containsExactly("precio");
  }
}
