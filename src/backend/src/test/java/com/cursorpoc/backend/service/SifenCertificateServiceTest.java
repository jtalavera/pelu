package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
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
import org.junit.jupiter.api.io.TempDir;
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

  @TempDir private java.nio.file.Path tempDir;

  @Mock private TenantRepository tenantRepository;
  @Mock private AppUserRepository appUserRepository;
  @Mock private SifenCertificateRepository sifenCertificateRepository;

  // RT-12 (Hardening_SIFEN.md): a real LocalFileSifenCertificateSecretStore over a @TempDir, not a
  // mock — keeps the upload -> requireActiveCertificate round trip genuinely exercised end to end,
  // same discipline the fixture .p12 already gave this suite pre-RT-12.
  private LocalFileSifenCertificateSecretStore secretStore;
  private SifenCertificateService service;

  private Tenant tenant;
  private AppUser uploader;
  private String validP12Base64;

  @BeforeEach
  void setUp() throws IOException {
    secretStore = new LocalFileSifenCertificateSecretStore(tempDir.toString());
    service =
        new SifenCertificateService(
            tenantRepository,
            appUserRepository,
            sifenCertificateRepository,
            secretStore,
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
  void upload_validCertificate_storesOnlySecretRefsNeverRawMaterial() {
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
    // RT-12: the entity holds only references — neither the password nor any p12 bytes are ever
    // set on it directly, and the reference names carry the RT-13 per-tenant naming convention.
    assertThat(saved.getP12SecretName()).matches("^sifen-cert-t1-[0-9a-f-]+-p12$");
    assertThat(saved.getPasswordSecretName()).matches("^sifen-cert-t1-[0-9a-f-]+-pwd$");
    assertThat(saved.getP12SecretVersion()).isNotBlank();
    assertThat(saved.getPasswordSecretVersion()).isNotBlank();

    // And loading it back through the store round-trips the real material.
    var loaded =
        secretStore.load(
            1L,
            new SifenCertificateSecretStore.StoredSecretRef(
                saved.getP12SecretName(),
                saved.getP12SecretVersion(),
                saved.getPasswordSecretName(),
                saved.getPasswordSecretVersion()));
    assertThat(loaded.password()).isEqualTo(FIXTURE_PASSWORD);
    assertThat(Base64.getEncoder().encodeToString(loaded.p12Bytes())).isEqualTo(validP12Base64);
  }

  /** RT-12: capped by the Key Vault secret value limit (25 KB) — see MAX_FILE_BYTES's javadoc. */
  @Test
  void upload_fileOverKeyVaultSecretLimit_rejectedAsTooLarge() {
    byte[] oversized = new byte[20_000];
    String oversizedBase64 = Base64.getEncoder().encodeToString(oversized);
    var request = new SifenCertificateUploadRequest(oversizedBase64, FIXTURE_PASSWORD);

    assertThatThrownBy(() -> service.upload(1L, 7L, request))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_CERT_FILE_TOO_LARGE");
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

  /**
   * RT-26 (Hardening_SIFEN.md): Manual Técnico V150, Tabla E requires an RSA key of 2048 or 4096
   * bits. {@code weak-key-cert.p12} carries a 1024-bit RSA key (and a conformant clientAuth EKU, to
   * isolate this one check).
   */
  @Test
  void upload_weakRsaKey_rejectedWithSpecificError() throws IOException {
    String weakKeyBase64 = readFixtureBase64("sifen/weak-key-cert.p12");
    var request = new SifenCertificateUploadRequest(weakKeyBase64, FIXTURE_PASSWORD);

    assertThatThrownBy(() -> service.upload(1L, 7L, request))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_CERT_INVALID_KEY_SIZE");
  }

  /**
   * RT-26: Manual Técnico V150, Tabla E requires the "TLS Web Client Authentication" (clientAuth)
   * extended key usage. {@code no-client-auth-cert.p12} carries a conformant 2048-bit RSA key but
   * only the serverAuth EKU, to isolate this one check.
   */
  @Test
  void upload_missingClientAuthEku_rejectedWithSpecificError() throws IOException {
    String noClientAuthBase64 = readFixtureBase64("sifen/no-client-auth-cert.p12");
    var request = new SifenCertificateUploadRequest(noClientAuthBase64, FIXTURE_PASSWORD);

    assertThatThrownBy(() -> service.upload(1L, 7L, request))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_CERT_MISSING_CLIENT_AUTH");
  }

  private static String readFixtureBase64(String classpathResource) throws IOException {
    byte[] bytes =
        Files.readAllBytes(
            java.nio.file.Path.of(
                SifenCertificateServiceTest.class
                    .getClassLoader()
                    .getResource(classpathResource)
                    .getPath()));
    return Base64.getEncoder().encodeToString(bytes);
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
    cert.setP12SecretName("sifen-cert-t1-fixture-p12");
    cert.setP12SecretVersion("1");
    cert.setPasswordSecretName("sifen-cert-t1-fixture-pwd");
    cert.setPasswordSecretVersion("1");
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
    var ref = secretStore.store(1L, Base64.getDecoder().decode(validP12Base64), FIXTURE_PASSWORD);
    c.setP12SecretName(ref.p12SecretName());
    c.setP12SecretVersion(ref.p12SecretVersion());
    c.setPasswordSecretName(ref.passwordSecretName());
    c.setPasswordSecretVersion(ref.passwordSecretVersion());
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
