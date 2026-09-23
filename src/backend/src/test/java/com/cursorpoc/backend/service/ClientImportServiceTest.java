package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.excelimport.ExcelHeaderValidationService;
import com.cursorpoc.backend.excelimport.ImportColumnTemplateRegistry;
import com.cursorpoc.backend.excelimport.ImportResult;
import com.cursorpoc.backend.repository.ClientRepository;
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
 * HU-52: the actual upload -> parse data rows -> validate row-by-row -> persist flow for
 * "clientes", built on top of HU-50's header validation, mirroring HU-51's {@code
 * ServiceImportServiceTest}.
 */
@ExtendWith(MockitoExtension.class)
class ClientImportServiceTest {

  @Mock private TenantRepository tenantRepository;
  @Mock private ClientRepository clientRepository;

  private ClientImportService service;

  private Tenant tenant;

  @BeforeEach
  void setUp() {
    ExcelHeaderValidationService headerValidationService =
        new ExcelHeaderValidationService(new ImportColumnTemplateRegistry());
    service = new ClientImportService(tenantRepository, clientRepository, headerValidationService);

    tenant = new Tenant();
    tenant.setId(1L);
    tenant.setName("Demo");
    lenient().when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    lenient().when(clientRepository.findByTenant_Id(1L)).thenReturn(List.of());
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

  private static final String[] CLIENT_HEADERS = {
    "nombre_completo", "telefono", "email", "ruc", "documento_identidad", "direccion", "activo"
  };

  // AC-2: a blank nombre_completo rejects only that row.
  @Test
  void blankFullName_isRejected() {
    byte[] bytes = workbook(CLIENT_HEADERS, new String[] {"", "0981123456"});
    ImportResult result = service.importClients(1L, bytes);

    assertThat(result.failedCount()).isEqualTo(1);
    assertThat(result.rows().get(0).errorCode())
        .isEqualTo(ClientImportService.ERROR_FULL_NAME_REQUIRED);
    verify(clientRepository, never()).save(any());
  }

  // AC-5: only nombre_completo is required; every other column may be blank.
  @Test
  void onlyFullName_isValid() {
    byte[] bytes = workbook(CLIENT_HEADERS, new String[] {"Maria Gonzalez"});
    ImportResult result = service.importClients(1L, bytes);

    assertThat(result.importedCount()).isEqualTo(1);
    verify(clientRepository)
        .save(
            org.mockito.ArgumentMatchers.argThat(
                (Client c) ->
                    c.getFullName().equals("MARIA GONZALEZ")
                        && c.getPhone() == null
                        && c.getEmail() == null
                        && c.getRuc() == null
                        && c.isActive()));
  }

  // AC-4: an invalid RUC format rejects only that row.
  @Test
  void invalidRucFormat_rejectsOnlyThatRow() {
    byte[] bytes =
        workbook(
            CLIENT_HEADERS,
            new String[] {"Maria Gonzalez", null, null, "no-es-un-ruc"},
            new String[] {"Juan Perez", null, null, "80000005-6"});
    ImportResult result = service.importClients(1L, bytes);

    assertThat(result.failedCount()).isEqualTo(1);
    assertThat(result.importedCount()).isEqualTo(1);
    assertThat(result.rows().get(0).errorCode()).isEqualTo(ClientImportService.ERROR_RUC_INVALID);
  }

  // AC-3: two rows in the same file sharing a non-blank phone — only the first is imported.
  @Test
  void duplicatePhoneInSameFile_onlySecondIsRejected() {
    byte[] bytes =
        workbook(
            CLIENT_HEADERS,
            new String[] {"Maria Gonzalez", "0981123456"},
            new String[] {"Otra Persona", "(0981) 123-456"});
    ImportResult result = service.importClients(1L, bytes);

    assertThat(result.importedCount()).isEqualTo(1);
    assertThat(result.failedCount()).isEqualTo(1);
    assertThat(result.rows().get(1).errorCode())
        .isEqualTo(ClientImportService.ERROR_PHONE_DUPLICATE);
    verify(clientRepository, org.mockito.Mockito.times(1)).save(any());
  }

  // AC-3: a non-blank email duplicating an existing tenant client (case-insensitive) rejects the
  // row.
  @Test
  void duplicateEmailAgainstExistingClient_isRejected() {
    Client existing = new Client();
    existing.setId(9L);
    existing.setTenant(tenant);
    existing.setFullName("EXISTENTE");
    existing.setEmail("cliente@example.com");
    existing.setActive(true);
    lenient().when(clientRepository.findByTenant_Id(1L)).thenReturn(List.of(existing));

    byte[] bytes =
        workbook(CLIENT_HEADERS, new String[] {"Nuevo Cliente", null, "Cliente@Example.com"});
    ImportResult result = service.importClients(1L, bytes);

    assertThat(result.failedCount()).isEqualTo(1);
    assertThat(result.rows().get(0).errorCode())
        .isEqualTo(ClientImportService.ERROR_EMAIL_DUPLICATE);
    verify(clientRepository, never()).save(any());
  }

  // AC-3: a non-blank RUC duplicating an existing tenant client rejects the row.
  @Test
  void duplicateRucAgainstExistingClient_isRejected() {
    Client existing = new Client();
    existing.setId(9L);
    existing.setTenant(tenant);
    existing.setFullName("EXISTENTE");
    existing.setRuc("80000005-6");
    existing.setActive(true);
    lenient().when(clientRepository.findByTenant_Id(1L)).thenReturn(List.of(existing));

    byte[] bytes =
        workbook(CLIENT_HEADERS, new String[] {"Nuevo Cliente", null, null, "80000005-6"});
    ImportResult result = service.importClients(1L, bytes);

    assertThat(result.failedCount()).isEqualTo(1);
    assertThat(result.rows().get(0).errorCode()).isEqualTo(ClientImportService.ERROR_RUC_DUPLICATE);
    verify(clientRepository, never()).save(any());
  }

  // AC-3 (PRD cross-cutting rule): blank telefono/email/ruc never collide across rows.
  @Test
  void blankContactFields_neverCollideAcrossRows() {
    byte[] bytes =
        workbook(CLIENT_HEADERS, new String[] {"Cliente Uno"}, new String[] {"Cliente Dos"});
    ImportResult result = service.importClients(1L, bytes);

    assertThat(result.importedCount()).isEqualTo(2);
    assertThat(result.failedCount()).isEqualTo(0);
  }

  // Rows that pass validation still import even when other rows in the same file fail (per-row
  // independence, PRD "transaccional por archivo").
  @Test
  void invalidRowDoesNotBlockOtherValidRowsInTheSameFile() {
    byte[] bytes =
        workbook(
            CLIENT_HEADERS,
            new String[] {"", "0981123456", null, null},
            new String[] {"Cliente Valido", null, null, null});
    ImportResult result = service.importClients(1L, bytes);

    assertThat(result.totalRows()).isEqualTo(2);
    assertThat(result.importedCount()).isEqualTo(1);
    assertThat(result.failedCount()).isEqualTo(1);
  }

  // AC-6: every created client is tied to the target tenant.
  @Test
  void createdClients_areScopedToTheTargetTenant() {
    byte[] bytes = workbook(CLIENT_HEADERS, new String[] {"Cliente Uno"});
    service.importClients(1L, bytes);

    verify(clientRepository)
        .save(org.mockito.ArgumentMatchers.argThat(c -> c.getTenant() == tenant));
  }

  // "activo" defaults to true (SI) when blank, and false only when explicitly "NO".
  @Test
  void activo_defaultsToTrueAndRespectsExplicitNo() {
    byte[] bytes =
        workbook(
            CLIENT_HEADERS,
            new String[] {"Cliente Uno", null, null, null, null, null, ""},
            new String[] {"Cliente Dos", null, null, null, null, null, "NO"});
    ImportResult result = service.importClients(1L, bytes);

    assertThat(result.importedCount()).isEqualTo(2);
    verify(clientRepository).save(org.mockito.ArgumentMatchers.argThat(Client::isActive));
    verify(clientRepository).save(org.mockito.ArgumentMatchers.argThat(c -> !c.isActive()));
  }

  // HU-50 AC-5: a missing required column rejects the whole file before any row is processed.
  @Test
  void missingRequiredColumn_rejectsWholeFileBeforeAnyRowIsProcessed() {
    byte[] bytes = workbook(new String[] {"telefono", "email"});
    ImportResult result = service.importClients(1L, bytes);

    assertThat(result.fileAccepted()).isFalse();
    assertThat(result.missingRequiredColumns()).containsExactly("nombre_completo");
    assertThat(result.totalRows()).isEqualTo(0);
    verify(clientRepository, never()).save(any());
  }

  // A tenant that does not exist is rejected outright, before any row processing.
  @Test
  void unknownTenant_throwsNotFound() {
    byte[] bytes = workbook(CLIENT_HEADERS, new String[] {"Cliente Uno"});
    assertThatThrownBy(() -> service.importClients(999L, bytes))
        .isInstanceOf(ResponseStatusException.class);
  }

  // AC-6: a different tenant's matching telefono/email/ruc never collides with this import.
  @Test
  void matchingContactInDifferentTenant_doesNotCollide() {
    lenient().when(clientRepository.findByTenant_Id(1L)).thenReturn(List.of());
    byte[] bytes =
        workbook(CLIENT_HEADERS, new String[] {"Cliente Uno", "0981123456", "cliente@example.com"});
    ImportResult result = service.importClients(1L, bytes);

    assertThat(result.importedCount()).isEqualTo(1);
    assertThat(result.failedCount()).isEqualTo(0);
  }
}
