package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.excelimport.ExcelHeaderValidationService;
import com.cursorpoc.backend.excelimport.ImportColumnTemplateRegistry;
import com.cursorpoc.backend.excelimport.ImportResult;
import com.cursorpoc.backend.repository.ProfessionalRepository;
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
 * HU-53: the actual upload -> parse data rows -> validate row-by-row -> persist flow for
 * "profesionales", built on top of HU-50's header validation, mirroring HU-52's {@code
 * ClientImportServiceTest}.
 */
@ExtendWith(MockitoExtension.class)
class ProfessionalImportServiceTest {

  @Mock private TenantRepository tenantRepository;
  @Mock private ProfessionalRepository professionalRepository;

  private ProfessionalImportService service;

  private Tenant tenant;

  @BeforeEach
  void setUp() {
    ExcelHeaderValidationService headerValidationService =
        new ExcelHeaderValidationService(new ImportColumnTemplateRegistry());
    service =
        new ProfessionalImportService(
            tenantRepository, professionalRepository, headerValidationService);

    tenant = new Tenant();
    tenant.setId(1L);
    tenant.setName("Demo");
    lenient().when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    lenient()
        .when(professionalRepository.findByTenant_IdOrderByFullNameAsc(1L))
        .thenReturn(List.of());
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

  private static final String[] PROFESSIONAL_HEADERS = {
    "nombre_completo", "telefono", "email", "direccion", "activo"
  };

  // AC-2: a blank nombre_completo rejects only that row.
  @Test
  void blankFullName_isRejected() {
    byte[] bytes = workbook(PROFESSIONAL_HEADERS, new String[] {"", "0981123456"});
    ImportResult result = service.importProfessionals(1L, bytes);

    assertThat(result.failedCount()).isEqualTo(1);
    assertThat(result.rows().get(0).errorCode())
        .isEqualTo(ProfessionalImportService.ERROR_FULL_NAME_REQUIRED);
    verify(professionalRepository, never()).save(any());
  }

  // AC-5: only nombre_completo is required; every other column may be blank.
  @Test
  void onlyFullName_isValid() {
    byte[] bytes = workbook(PROFESSIONAL_HEADERS, new String[] {"Maria Gonzalez"});
    ImportResult result = service.importProfessionals(1L, bytes);

    assertThat(result.importedCount()).isEqualTo(1);
    verify(professionalRepository)
        .save(
            org.mockito.ArgumentMatchers.argThat(
                (Professional p) ->
                    p.getFullName().equals("MARIA GONZALEZ")
                        && p.getPhone() == null
                        && p.getEmail() == null
                        && p.getAddress() == null
                        && p.isActive()));
  }

  // AC-3: imported professionals are created with no PIN and no system access, exactly like a
  // manual alta before HU-22's separate PIN/access step.
  @Test
  void importedProfessional_hasNoPinAndNoSystemAccess() {
    byte[] bytes = workbook(PROFESSIONAL_HEADERS, new String[] {"Maria Gonzalez"});
    service.importProfessionals(1L, bytes);

    verify(professionalRepository)
        .save(
            org.mockito.ArgumentMatchers.argThat(
                (Professional p) -> p.getPinFingerprint() == null && !p.isSystemAccessAllowed()));
  }

  // AC-4: "activo" defaults to true (SI) when blank, and false only when explicitly "NO".
  @Test
  void activo_defaultsToTrueAndRespectsExplicitNo() {
    byte[] bytes =
        workbook(
            PROFESSIONAL_HEADERS,
            new String[] {"Profesional Uno", null, null, null, ""},
            new String[] {"Profesional Dos", null, null, null, "NO"});
    ImportResult result = service.importProfessionals(1L, bytes);

    assertThat(result.importedCount()).isEqualTo(2);
    verify(professionalRepository)
        .save(org.mockito.ArgumentMatchers.argThat(Professional::isActive));
    verify(professionalRepository).save(org.mockito.ArgumentMatchers.argThat(p -> !p.isActive()));
  }

  // AC-6: an incomplete Paraguay phone number rejects only that row.
  @Test
  void invalidPhoneFormat_rejectsOnlyThatRow() {
    byte[] bytes =
        workbook(
            PROFESSIONAL_HEADERS,
            new String[] {"Maria Gonzalez", "12345"},
            new String[] {"Juan Perez", "0981123456"});
    ImportResult result = service.importProfessionals(1L, bytes);

    assertThat(result.failedCount()).isEqualTo(1);
    assertThat(result.importedCount()).isEqualTo(1);
    assertThat(result.rows().get(0).errorCode())
        .isEqualTo(ProfessionalImportService.ERROR_PHONE_INVALID);
  }

  // AC-6: an invalid email format rejects only that row.
  @Test
  void invalidEmailFormat_rejectsOnlyThatRow() {
    byte[] bytes =
        workbook(
            PROFESSIONAL_HEADERS,
            new String[] {"Maria Gonzalez", null, "not-an-email"},
            new String[] {"Juan Perez", null, "juan.perez@example.com"});
    ImportResult result = service.importProfessionals(1L, bytes);

    assertThat(result.failedCount()).isEqualTo(1);
    assertThat(result.importedCount()).isEqualTo(1);
    assertThat(result.rows().get(0).errorCode())
        .isEqualTo(ProfessionalImportService.ERROR_EMAIL_INVALID);
  }

  // AC-6: a non-blank email duplicating an existing tenant professional (case-insensitive)
  // rejects the row, matching PROFESSIONAL_EMAIL_DUPLICATE from manual creation.
  @Test
  void duplicateEmailAgainstExistingProfessional_isRejected() {
    Professional existing = new Professional();
    existing.setId(9L);
    existing.setTenant(tenant);
    existing.setFullName("EXISTENTE");
    existing.setEmail("profesional@example.com");
    existing.setActive(true);
    lenient()
        .when(professionalRepository.findByTenant_IdOrderByFullNameAsc(1L))
        .thenReturn(List.of(existing));

    byte[] bytes =
        workbook(
            PROFESSIONAL_HEADERS,
            new String[] {"Nuevo Profesional", null, "Profesional@Example.com"});
    ImportResult result = service.importProfessionals(1L, bytes);

    assertThat(result.failedCount()).isEqualTo(1);
    assertThat(result.rows().get(0).errorCode())
        .isEqualTo(ProfessionalImportService.ERROR_EMAIL_DUPLICATE);
    verify(professionalRepository, never()).save(any());
  }

  // AC-6: two rows in the same file sharing a non-blank email — only the first is imported.
  @Test
  void duplicateEmailInSameFile_onlySecondIsRejected() {
    byte[] bytes =
        workbook(
            PROFESSIONAL_HEADERS,
            new String[] {"Maria Gonzalez", null, "prof@example.com"},
            new String[] {"Otra Persona", null, "PROF@Example.com"});
    ImportResult result = service.importProfessionals(1L, bytes);

    assertThat(result.importedCount()).isEqualTo(1);
    assertThat(result.failedCount()).isEqualTo(1);
    assertThat(result.rows().get(1).errorCode())
        .isEqualTo(ProfessionalImportService.ERROR_EMAIL_DUPLICATE);
    verify(professionalRepository, org.mockito.Mockito.times(1)).save(any());
  }

  // Rows that pass validation still import even when other rows in the same file fail (per-row
  // independence, PRD "transaccional por archivo").
  @Test
  void invalidRowDoesNotBlockOtherValidRowsInTheSameFile() {
    byte[] bytes =
        workbook(
            PROFESSIONAL_HEADERS,
            new String[] {"", "0981123456", null, null},
            new String[] {"Profesional Valido", null, null, null});
    ImportResult result = service.importProfessionals(1L, bytes);

    assertThat(result.totalRows()).isEqualTo(2);
    assertThat(result.importedCount()).isEqualTo(1);
    assertThat(result.failedCount()).isEqualTo(1);
  }

  // AC-7 (isolation): every created professional is tied to the target tenant.
  @Test
  void createdProfessionals_areScopedToTheTargetTenant() {
    byte[] bytes = workbook(PROFESSIONAL_HEADERS, new String[] {"Profesional Uno"});
    service.importProfessionals(1L, bytes);

    verify(professionalRepository)
        .save(org.mockito.ArgumentMatchers.argThat(p -> p.getTenant() == tenant));
  }

  // AC-7: a different tenant's matching email never collides with this import.
  @Test
  void matchingEmailInDifferentTenant_doesNotCollide() {
    lenient()
        .when(professionalRepository.findByTenant_IdOrderByFullNameAsc(1L))
        .thenReturn(List.of());
    byte[] bytes =
        workbook(PROFESSIONAL_HEADERS, new String[] {"Profesional Uno", null, "prof@example.com"});
    ImportResult result = service.importProfessionals(1L, bytes);

    assertThat(result.importedCount()).isEqualTo(1);
    assertThat(result.failedCount()).isEqualTo(0);
  }

  // HU-50 AC-5: a missing required column rejects the whole file before any row is processed.
  @Test
  void missingRequiredColumn_rejectsWholeFileBeforeAnyRowIsProcessed() {
    byte[] bytes = workbook(new String[] {"telefono", "email"});
    ImportResult result = service.importProfessionals(1L, bytes);

    assertThat(result.fileAccepted()).isFalse();
    assertThat(result.missingRequiredColumns()).containsExactly("nombre_completo");
    assertThat(result.totalRows()).isEqualTo(0);
    verify(professionalRepository, never()).save(any());
  }

  // A tenant that does not exist is rejected outright, before any row processing.
  @Test
  void unknownTenant_throwsNotFound() {
    byte[] bytes = workbook(PROFESSIONAL_HEADERS, new String[] {"Profesional Uno"});
    assertThatThrownBy(() -> service.importProfessionals(999L, bytes))
        .isInstanceOf(ResponseStatusException.class);
  }
}
