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

  /**
   * The service computes "today" in the business zone ({@link FemmeTimeProperties}), never the JVM
   * default zone — boundary-sensitive dates below must use this same zone, or they only pass by
   * coincidence on a machine whose default zone happens to match (as this repo's local dev default
   * does, unlike CI runners, which default to UTC).
   */
  private static final java.time.ZoneId BUSINESS_ZONE = new FemmeTimeProperties().zoneId();

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
    assertThat(dto.notBefore()).isBeforeOrEqualTo(LocalDate.now(BUSINESS_ZONE));
    assertThat(dto.notAfter()).isAfter(LocalDate.now(BUSINESS_ZONE));

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

  // Also covers HU-19 AC-04 (the certificate listing screen never shows another tenant's
  // certificates) — HU-19 reuses this same list() unchanged. Same precedent as HU-18's own AC-07:
  // no second-tenant fixture exists yet for Playwright (see PROGRESS.md "Desviación conocida"), so
  // tenant isolation for the listing is proven here, at the repository-query level.
  @Test
  void list_onlyQueriesRequestedTenant_neverLeaksOtherTenants() {
    SifenCertificate own = new SifenCertificate();
    own.setId(1L);
    own.setUploadedAt(java.time.Instant.now());
    own.setNotBefore(LocalDate.now(BUSINESS_ZONE));
    own.setNotAfter(LocalDate.now(BUSINESS_ZONE).plusYears(1));
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
        certificate(
            1L,
            LocalDate.now(BUSINESS_ZONE).minusDays(10),
            LocalDate.now(BUSINESS_ZONE).plusDays(10));
    when(sifenCertificateRepository.findByTenant_IdOrderByUploadedAtDesc(1L))
        .thenReturn(List.of(cert));

    assertThat(service.list(1L).get(0).status()).isEqualTo(SifenCertificateStatus.VALID);
  }

  @Test
  void list_certificateOnValidityBoundaries_isStillValid() {
    // AC-01: today equal to notBefore or notAfter counts as valid (both bounds inclusive).
    SifenCertificate onNotBefore =
        certificate(1L, LocalDate.now(BUSINESS_ZONE), LocalDate.now(BUSINESS_ZONE).plusDays(1));
    SifenCertificate onNotAfter =
        certificate(2L, LocalDate.now(BUSINESS_ZONE).minusDays(1), LocalDate.now(BUSINESS_ZONE));
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
        certificate(
            1L,
            LocalDate.now(BUSINESS_ZONE).minusDays(30),
            LocalDate.now(BUSINESS_ZONE).minusDays(1));
    when(sifenCertificateRepository.findByTenant_IdOrderByUploadedAtDesc(1L))
        .thenReturn(List.of(cert));

    assertThat(service.list(1L).get(0).status()).isEqualTo(SifenCertificateStatus.EXPIRED);
  }

  @Test
  void list_certificateBeforeNotBefore_hasNotYetValidStatus() {
    SifenCertificate cert =
        certificate(
            1L,
            LocalDate.now(BUSINESS_ZONE).plusDays(1),
            LocalDate.now(BUSINESS_ZONE).plusDays(30));
    when(sifenCertificateRepository.findByTenant_IdOrderByUploadedAtDesc(1L))
        .thenReturn(List.of(cert));

    assertThat(service.list(1L).get(0).status()).isEqualTo(SifenCertificateStatus.NOT_YET_VALID);
  }

  @Test
  void list_multipleValidCertificatesForSameTenant_allReportValid() {
    // AC-05: more than one "Vigente" certificate at once is not an error; HU-21 decides which is
    // used.
    SifenCertificate first =
        certificate(
            1L,
            LocalDate.now(BUSINESS_ZONE).minusDays(5),
            LocalDate.now(BUSINESS_ZONE).plusDays(5));
    SifenCertificate second =
        certificate(
            2L,
            LocalDate.now(BUSINESS_ZONE).minusDays(1),
            LocalDate.now(BUSINESS_ZONE).plusDays(365));
    when(sifenCertificateRepository.findByTenant_IdOrderByUploadedAtDesc(1L))
        .thenReturn(List.of(first, second));

    assertThat(service.list(1L))
        .extracting(SifenCertificateResponse::status)
        .containsExactly(SifenCertificateStatus.VALID, SifenCertificateStatus.VALID);
  }

  // HU-19: the listing endpoint reuses this same list() — these two cases cover its ACs that
  // AC-04 (tenant isolation, already proven above by list_onlyQueriesRequestedTenant_
  // neverLeaksOtherTenants) doesn't: AC-02/AC-03 (exactly the 4 allowed fields, nothing else) and
  // AC-06 (every historical certificate, not just the newest, all returned in the repository's
  // order). No Playwright-testable AC exists for this without a screen — see
  // sifen-hu-19-listado-certificados.spec.ts for the UI-level coverage of the same criteria.

  @Test
  void list_exposesOnlyTheFourAllowedFieldsPerCertificate_neverPrivateKeyOrPassword() {
    SifenCertificate cert =
        certificate(
            1L,
            LocalDate.now(BUSINESS_ZONE).minusDays(10),
            LocalDate.now(BUSINESS_ZONE).plusDays(10));
    cert.setEncryptedP12Base64("super-secret-p12-bytes");
    cert.setEncryptedPasswordBase64("super-secret-password");
    when(sifenCertificateRepository.findByTenant_IdOrderByUploadedAtDesc(1L))
        .thenReturn(List.of(cert));

    SifenCertificateResponse dto = service.list(1L).get(0);

    // The record type itself has exactly these 5 components (id + the 4 AC-02 fields) — asserting
    // their values here, plus the type's own shape, is what guarantees AC-03: there is no
    // getter/field on SifenCertificateResponse capable of leaking the encrypted material at all.
    assertThat(dto.id()).isEqualTo(1L);
    assertThat(dto.uploadedAt()).isEqualTo(cert.getUploadedAt());
    assertThat(dto.notBefore()).isEqualTo(cert.getNotBefore());
    assertThat(dto.notAfter()).isEqualTo(cert.getNotAfter());
    assertThat(dto.status()).isEqualTo(SifenCertificateStatus.VALID);
    assertThat(SifenCertificateResponse.class.getDeclaredFields()).hasSize(5);
  }

  @Test
  void list_includesEveryHistoricalCertificate_notOnlyTheMostRecent() {
    // AC-06: uploading new certificates never hides older ones from the listing (HU-18 AC-10
    // already guarantees they aren't deleted; this proves list() doesn't filter them out either).
    SifenCertificate oldest =
        certificate(
            1L,
            LocalDate.now(BUSINESS_ZONE).minusYears(3),
            LocalDate.now(BUSINESS_ZONE).minusYears(2));
    SifenCertificate newest =
        certificate(
            2L,
            LocalDate.now(BUSINESS_ZONE).minusDays(1),
            LocalDate.now(BUSINESS_ZONE).plusYears(1));
    // Repository method is *OrderByUploadedAtDesc — most recent upload first.
    when(sifenCertificateRepository.findByTenant_IdOrderByUploadedAtDesc(1L))
        .thenReturn(List.of(newest, oldest));

    assertThat(service.list(1L)).extracting(SifenCertificateResponse::id).containsExactly(2L, 1L);
  }

  private static SifenCertificate certificate(long id, LocalDate notBefore, LocalDate notAfter) {
    SifenCertificate c = new SifenCertificate();
    c.setId(id);
    c.setUploadedAt(java.time.Instant.now());
    c.setNotBefore(notBefore);
    c.setNotAfter(notAfter);
    return c;
  }

  // HU-21: requireActiveCertificate() resolves the certificate/key an operation (HU-04, HU-05,
  // HU-10, HU-11, EP-05) should use — these certs carry real encrypted material (round-tripped
  // through the fixture .p12) so decryption is exercised end to end, not just the status filter.

  private SifenCertificate certificateWithMaterial(
      long id, LocalDate notBefore, LocalDate notAfter) {
    SifenCertificate c = certificate(id, notBefore, notAfter);
    c.setEncryptedP12Base64(encryptionService.encrypt(Base64.getDecoder().decode(validP12Base64)));
    c.setEncryptedPasswordBase64(encryptionService.encrypt(FIXTURE_PASSWORD));
    return c;
  }

  @Test
  void requireActiveCertificate_decryptsRealMaterial_forSingleValidCertificate() {
    SifenCertificate cert =
        certificateWithMaterial(
            5L,
            LocalDate.now(BUSINESS_ZONE).minusDays(1),
            LocalDate.now(BUSINESS_ZONE).plusYears(1));
    when(sifenCertificateRepository.findByTenant_IdOrderByUploadedAtDesc(1L))
        .thenReturn(List.of(cert));

    var material = service.requireActiveCertificate(1L);

    assertThat(material.certificateId()).isEqualTo(5L);
    assertThat(material.keystorePassword()).isEqualTo(FIXTURE_PASSWORD);
    assertThat(material.privateKey().getAlgorithm()).isEqualTo("RSA");
    assertThat(material.certificate().getSubjectX500Principal().getName()).contains("Test Sifen");
  }

  @Test
  void requireActiveCertificate_picksFurthestExpiry_whenMultipleValid() {
    // AC-03: consistently the same one — furthest notAfter.
    SifenCertificate soonerExpiry =
        certificateWithMaterial(
            1L,
            LocalDate.now(BUSINESS_ZONE).minusDays(5),
            LocalDate.now(BUSINESS_ZONE).plusDays(30));
    SifenCertificate furtherExpiry =
        certificateWithMaterial(
            2L,
            LocalDate.now(BUSINESS_ZONE).minusDays(1),
            LocalDate.now(BUSINESS_ZONE).plusYears(5));
    when(sifenCertificateRepository.findByTenant_IdOrderByUploadedAtDesc(1L))
        .thenReturn(List.of(soonerExpiry, furtherExpiry));

    assertThat(service.requireActiveCertificate(1L).certificateId()).isEqualTo(2L);
  }

  @Test
  void requireActiveCertificate_throwsPreconditionFailed_whenNoValidCertificate() {
    // AC-02: no "Vigente" certificate at all blocks the operation with a specific error.
    when(sifenCertificateRepository.findByTenant_IdOrderByUploadedAtDesc(1L)).thenReturn(List.of());

    assertThatThrownBy(() -> service.requireActiveCertificate(1L))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_NO_VALID_CERTIFICATE");
  }

  @Test
  void requireActiveCertificate_ignoresExpiredOrNotYetValidCertificates() {
    // AC-02/AC-05: an expired (or not-yet-valid) certificate never gets chosen, even if it is the
    // only one on file — the operation must be blocked exactly as if there were none.
    SifenCertificate expired =
        certificateWithMaterial(
            1L,
            LocalDate.now(BUSINESS_ZONE).minusDays(30),
            LocalDate.now(BUSINESS_ZONE).minusDays(1));
    when(sifenCertificateRepository.findByTenant_IdOrderByUploadedAtDesc(1L))
        .thenReturn(List.of(expired));

    assertThatThrownBy(() -> service.requireActiveCertificate(1L))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_NO_VALID_CERTIFICATE");
  }

  @Test
  void requireActiveCertificate_onlyEverResolvesFromTheRequestedTenant() {
    // AC-04: no cache exists across calls, so a lookup for one tenant can never return another's.
    SifenCertificate tenantOnesCert =
        certificateWithMaterial(
            1L,
            LocalDate.now(BUSINESS_ZONE).minusDays(1),
            LocalDate.now(BUSINESS_ZONE).plusYears(1));
    when(sifenCertificateRepository.findByTenant_IdOrderByUploadedAtDesc(1L))
        .thenReturn(List.of(tenantOnesCert));
    when(sifenCertificateRepository.findByTenant_IdOrderByUploadedAtDesc(2L)).thenReturn(List.of());

    assertThat(service.requireActiveCertificate(1L).certificateId()).isEqualTo(1L);
    assertThatThrownBy(() -> service.requireActiveCertificate(2L))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_NO_VALID_CERTIFICATE");
  }
}
