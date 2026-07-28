package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.config.SifenCertificateProperties;
import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.SifenCertificate;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.SifenCertificateStatus;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.SifenCertificateRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.SifenCertificateResponse;
import com.cursorpoc.backend.web.dto.SifenCertificateUploadRequest;
import java.io.IOException;
import java.nio.file.Files;
import java.time.LocalDate;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;

@ExtendWith(MockitoExtension.class)
class SifenCertificateServiceTest {

  private static final String FIXTURE_PASSWORD = "TestPass123!";

  @Mock private TenantRepository tenantRepository;
  @Mock private AppUserRepository appUserRepository;
  @Mock private SifenCertificateRepository sifenCertificateRepository;

  private SifenCertificateEncryptionService encryptionService;
  private SifenCertificateService service;

  private Tenant tenant;
  private AppUser uploader;
  private String validP12Base64;

  @BeforeEach
  void setUp() throws IOException {
    SifenCertificateProperties props = new SifenCertificateProperties();
    props.setCertEncryptionKey("enOvRBV4YK7cD2WVPl0pMOLFRq5xGVCnGBNLse2/XUY=");
    encryptionService = new SifenCertificateEncryptionService(props);
    service =
        new SifenCertificateService(
            tenantRepository,
            appUserRepository,
            sifenCertificateRepository,
            encryptionService,
            new FemmeTimeProperties());

    tenant = new Tenant();
    tenant.setId(1L);
    tenant.setName("T");

    uploader = new AppUser();
    uploader.setId(7L);

    byte[] p12Bytes =
        Files.readAllBytes(
            java.nio.file.Path.of(
                getClass().getClassLoader().getResource("sifen/test-cert.p12").getPath()));
    validP12Base64 = Base64.getEncoder().encodeToString(p12Bytes);
  }

  @Test
  void upload_validCertificate_extractsDatesAndStoresEncrypted() {
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    when(appUserRepository.findById(7L)).thenReturn(Optional.of(uploader));
    when(sifenCertificateRepository.save(any(SifenCertificate.class)))
        .thenAnswer(
            inv -> {
              SifenCertificate c = inv.getArgument(0);
              c.setId(99L);
              return c;
            });

    var request = new SifenCertificateUploadRequest(validP12Base64, FIXTURE_PASSWORD);
    SifenCertificateResponse dto = service.upload(1L, 7L, request);

    assertThat(dto.id()).isEqualTo(99L);
    assertThat(dto.notBefore()).isBeforeOrEqualTo(LocalDate.now());
    assertThat(dto.notAfter()).isAfter(LocalDate.now());

    ArgumentCaptor<SifenCertificate> captor = ArgumentCaptor.forClass(SifenCertificate.class);
    verify(sifenCertificateRepository).save(captor.capture());
    SifenCertificate saved = captor.getValue();
    // AC-06: neither the private key material nor the password are recoverable without decrypting.
    assertThat(saved.getEncryptedP12Base64()).doesNotContain(FIXTURE_PASSWORD);
    assertThat(saved.getEncryptedPasswordBase64()).doesNotContain(FIXTURE_PASSWORD);
    assertThat(encryptionService.decryptToString(saved.getEncryptedPasswordBase64()))
        .isEqualTo(FIXTURE_PASSWORD);
  }

  @Test
  void upload_wrongPassword_rejectedWithSpecificError() {
    var request = new SifenCertificateUploadRequest(validP12Base64, "not-the-password");
    assertThatThrownBy(() -> service.upload(1L, 7L, request))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_CERT_INVALID_PASSWORD");
  }

  @Test
  void upload_corruptFile_rejectedWithSpecificError() {
    String junkBase64 =
        Base64.getEncoder().encodeToString("this is not a keystore file at all".getBytes());
    var request = new SifenCertificateUploadRequest(junkBase64, FIXTURE_PASSWORD);
    assertThatThrownBy(() -> service.upload(1L, 7L, request))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_CERT_INVALID_FILE");
  }

  @Test
  void upload_malformedBase64_rejectedAsInvalidFile() {
    var request = new SifenCertificateUploadRequest("%%%not-base64%%%", FIXTURE_PASSWORD);
    assertThatThrownBy(() -> service.upload(1L, 7L, request))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_CERT_INVALID_FILE");
  }

  @Test
  void list_onlyQueriesRequestedTenant_neverLeaksOtherTenants() {
    SifenCertificate own = new SifenCertificate();
    own.setId(1L);
    own.setUploadedAt(java.time.Instant.now());
    own.setNotBefore(LocalDate.now());
    own.setNotAfter(LocalDate.now().plusYears(1));
    when(sifenCertificateRepository.findByTenant_IdOrderByUploadedAtDesc(1L))
        .thenReturn(List.of(own));
    when(sifenCertificateRepository.findByTenant_IdOrderByUploadedAtDesc(2L)).thenReturn(List.of());

    List<SifenCertificateResponse> tenantOneList = service.list(1L);
    List<SifenCertificateResponse> tenantTwoList = service.list(2L);

    assertThat(tenantOneList).hasSize(1);
    assertThat(tenantOneList.get(0).id()).isEqualTo(1L);
    assertThat(tenantTwoList).isEmpty();
  }

  // HU-20: status is computed fresh on every list() call from notBefore/notAfter vs "today" —
  // never a stored value — so these build certs relative to the real current date rather than
  // mocking a clock.

  @Test
  void list_certificateWithinValidityWindow_hasValidStatus() {
    SifenCertificate cert =
        certificate(1L, LocalDate.now().minusDays(10), LocalDate.now().plusDays(10));
    when(sifenCertificateRepository.findByTenant_IdOrderByUploadedAtDesc(1L))
        .thenReturn(List.of(cert));

    assertThat(service.list(1L).get(0).status()).isEqualTo(SifenCertificateStatus.VALID);
  }

  @Test
  void list_certificateOnValidityBoundaries_isStillValid() {
    // AC-01: today equal to notBefore or notAfter counts as valid (both bounds inclusive).
    SifenCertificate onNotBefore = certificate(1L, LocalDate.now(), LocalDate.now().plusDays(1));
    SifenCertificate onNotAfter = certificate(2L, LocalDate.now().minusDays(1), LocalDate.now());
    when(sifenCertificateRepository.findByTenant_IdOrderByUploadedAtDesc(1L))
        .thenReturn(List.of(onNotBefore, onNotAfter));

    List<SifenCertificateResponse> dtos = service.list(1L);
    assertThat(dtos)
        .extracting(SifenCertificateResponse::status)
        .containsExactly(SifenCertificateStatus.VALID, SifenCertificateStatus.VALID);
  }

  @Test
  void list_certificatePastNotAfter_hasExpiredStatus() {
    SifenCertificate cert =
        certificate(1L, LocalDate.now().minusDays(30), LocalDate.now().minusDays(1));
    when(sifenCertificateRepository.findByTenant_IdOrderByUploadedAtDesc(1L))
        .thenReturn(List.of(cert));

    assertThat(service.list(1L).get(0).status()).isEqualTo(SifenCertificateStatus.EXPIRED);
  }

  @Test
  void list_certificateBeforeNotBefore_hasNotYetValidStatus() {
    SifenCertificate cert =
        certificate(1L, LocalDate.now().plusDays(1), LocalDate.now().plusDays(30));
    when(sifenCertificateRepository.findByTenant_IdOrderByUploadedAtDesc(1L))
        .thenReturn(List.of(cert));

    assertThat(service.list(1L).get(0).status()).isEqualTo(SifenCertificateStatus.NOT_YET_VALID);
  }

  @Test
  void list_multipleValidCertificatesForSameTenant_allReportValid() {
    // AC-05: more than one "Vigente" certificate at once is not an error; HU-21 decides which is
    // used.
    SifenCertificate first =
        certificate(1L, LocalDate.now().minusDays(5), LocalDate.now().plusDays(5));
    SifenCertificate second =
        certificate(2L, LocalDate.now().minusDays(1), LocalDate.now().plusDays(365));
    when(sifenCertificateRepository.findByTenant_IdOrderByUploadedAtDesc(1L))
        .thenReturn(List.of(first, second));

    assertThat(service.list(1L))
        .extracting(SifenCertificateResponse::status)
        .containsExactly(SifenCertificateStatus.VALID, SifenCertificateStatus.VALID);
  }

  private static SifenCertificate certificate(long id, LocalDate notBefore, LocalDate notAfter) {
    SifenCertificate c = new SifenCertificate();
    c.setId(id);
    c.setUploadedAt(java.time.Instant.now());
    c.setNotBefore(notBefore);
    c.setNotAfter(notAfter);
    return c;
  }
}
