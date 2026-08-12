package com.cursorpoc.backend.service;

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
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.UnrecoverableKeyException;
import java.security.cert.CertificateParsingException;
import java.security.cert.X509Certificate;
import java.security.interfaces.RSAPublicKey;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-18: upload and list SIFEN digital certificates (.p12 + password) for a tenant. Certificates
 * are stored encrypted at rest; only metadata (upload/validity dates) is ever exposed back to the
 * frontend.
 */
@Service
public class SifenCertificateService {

  private static final Logger log = LoggerFactory.getLogger(SifenCertificateService.class);

  /**
   * Generous cap for a .p12 file (typically a few KB); guards against abuse via the JSON payload.
   */
  private static final int MAX_FILE_BYTES = 1_000_000;

  /** RFC 5280 id-kp-clientAuth — "TLS Web Client Authentication". */
  private static final String CLIENT_AUTH_EKU_OID = "1.3.6.1.5.5.7.3.2";

  private final TenantRepository tenantRepository;
  private final AppUserRepository appUserRepository;
  private final SifenCertificateRepository sifenCertificateRepository;
  private final SifenCertificateEncryptionService encryptionService;
  private final FemmeTimeProperties timeProperties;

  public SifenCertificateService(
      TenantRepository tenantRepository,
      AppUserRepository appUserRepository,
      SifenCertificateRepository sifenCertificateRepository,
      SifenCertificateEncryptionService encryptionService,
      FemmeTimeProperties timeProperties) {
    this.tenantRepository = tenantRepository;
    this.appUserRepository = appUserRepository;
    this.sifenCertificateRepository = sifenCertificateRepository;
    this.encryptionService = encryptionService;
    this.timeProperties = timeProperties;
  }

  @Transactional(readOnly = true)
  public List<SifenCertificateResponse> list(long tenantId) {
    LocalDate today = LocalDate.now(timeProperties.zoneId());
    return sifenCertificateRepository.findByTenant_IdOrderByUploadedAtDesc(tenantId).stream()
        .map(c -> toDto(c, today))
        .collect(Collectors.toList());
  }

  @Transactional
  public SifenCertificateResponse upload(
      long tenantId, long uploadedByUserId, SifenCertificateUploadRequest request) {
    byte[] fileBytes = decodeFile(request.fileBase64());
    X509Certificate leafCertificate = parseAndValidate(fileBytes, request.password());
    // RT-26: checked alongside the rest of the file's own validity, before any DB lookup — same
    // "fail fast on the input itself" ordering as parseAndValidate above.
    validateTablaERequirements(leafCertificate);

    Tenant tenant =
        tenantRepository
            .findById(tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND"));
    AppUser uploadedBy =
        appUserRepository
            .findById(uploadedByUserId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND"));

    SifenCertificate entity = new SifenCertificate();
    entity.setTenant(tenant);
    entity.setUploadedBy(uploadedBy);
    entity.setEncryptedP12Base64(encryptionService.encrypt(fileBytes));
    entity.setEncryptedPasswordBase64(encryptionService.encrypt(request.password()));
    entity.setNotBefore(toLocalDate(leafCertificate.getNotBefore()));
    entity.setNotAfter(toLocalDate(leafCertificate.getNotAfter()));
    entity.setUploadedAt(Instant.now());
    sifenCertificateRepository.save(entity);

    log.info(
        "SIFEN certificate uploaded tenantId={} uploadedByUserId={} certificateId={}",
        tenantId,
        uploadedByUserId,
        entity.getId());
    return toDto(entity, LocalDate.now(timeProperties.zoneId()));
  }

  /**
   * HU-21: resolves the certificate/private key that any facturación-electrónica operation for this
   * tenant (sign, connect, register an event) must use — obtained fresh on every call, so a
   * certificate that expires or a newly-uploaded one is picked up immediately without a restart
   * (AC-05, AC-06), and never mixed across tenants (AC-04: no cross-call cache exists at all).
   */
  @Transactional(readOnly = true)
  public SifenActiveCertificateMaterial requireActiveCertificate(long tenantId) {
    LocalDate today = LocalDate.now(timeProperties.zoneId());
    SifenCertificate chosen =
        sifenCertificateRepository.findByTenant_IdOrderByUploadedAtDesc(tenantId).stream()
            .filter(c -> computeStatus(c, today) == SifenCertificateStatus.VALID)
            // AC-03: pick the same one consistently — furthest expiry, tie-broken by id.
            .max(
                Comparator.comparing(SifenCertificate::getNotAfter)
                    .thenComparing(SifenCertificate::getId))
            .orElseThrow(
                () -> {
                  log.warn(
                      "SIFEN active-certificate lookup found none valid tenantId={}", tenantId);
                  return new ResponseStatusException(
                      HttpStatus.PRECONDITION_FAILED, "SIFEN_NO_VALID_CERTIFICATE");
                });

    SifenActiveCertificateMaterial material = decryptMaterial(chosen);
    log.info(
        "SIFEN active-certificate resolved tenantId={} certificateId={}",
        tenantId,
        material.certificateId());
    return material;
  }

  private SifenActiveCertificateMaterial decryptMaterial(SifenCertificate c) {
    byte[] p12Bytes = encryptionService.decryptToBytes(c.getEncryptedP12Base64());
    String password = encryptionService.decryptToString(c.getEncryptedPasswordBase64());
    try {
      KeyStore keyStore = KeyStore.getInstance("PKCS12");
      keyStore.load(new ByteArrayInputStream(p12Bytes), password.toCharArray());
      String alias = findFirstAlias(keyStore);
      PrivateKey privateKey = (PrivateKey) keyStore.getKey(alias, password.toCharArray());
      X509Certificate certificate = (X509Certificate) keyStore.getCertificate(alias);
      return new SifenActiveCertificateMaterial(
          c.getId(), keyStore, password, alias, certificate, privateKey);
    } catch (GeneralSecurityException | IOException e) {
      // Already validated at upload time (HU-18) — reaching here means stored/decrypted material
      // is corrupted, not a user input error, so this is not a 4xx ResponseStatusException.
      throw new IllegalStateException(
          "Failed to load previously-validated SIFEN certificate id=" + c.getId(), e);
    }
  }

  private static byte[] decodeFile(String fileBase64) {
    try {
      byte[] bytes = Base64.getDecoder().decode(fileBase64);
      if (bytes.length == 0 || bytes.length > MAX_FILE_BYTES) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SIFEN_CERT_FILE_TOO_LARGE");
      }
      return bytes;
    } catch (IllegalArgumentException e) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SIFEN_CERT_INVALID_FILE");
    }
  }

  /**
   * Loads the PKCS12 keystore and returns its leaf certificate. Empirically (JDK 21, SunJSSE
   * provider): a wrong password surfaces as {@link IOException} caused by {@link
   * UnrecoverableKeyException}; a corrupt/non-PKCS12 file surfaces as any other {@link IOException}
   * (e.g. EOFException) or {@link GeneralSecurityException} with no such cause.
   */
  private static X509Certificate parseAndValidate(byte[] fileBytes, String password) {
    try {
      KeyStore keyStore = KeyStore.getInstance("PKCS12");
      keyStore.load(new ByteArrayInputStream(fileBytes), password.toCharArray());
      String alias = findFirstAlias(keyStore);
      return (X509Certificate) keyStore.getCertificate(alias);
    } catch (IOException e) {
      if (e.getCause() instanceof UnrecoverableKeyException) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SIFEN_CERT_INVALID_PASSWORD");
      }
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SIFEN_CERT_INVALID_FILE");
    } catch (GeneralSecurityException e) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SIFEN_CERT_INVALID_FILE");
    }
  }

  /**
   * RT-26 (Hardening_SIFEN.md): Manual Técnico V150, Tabla E requires an RSA key of 2048 or 4096
   * bits and the "TLS Web Client Authentication" (clientAuth) extended key usage. Validating this
   * here — at upload — gives the tenant admin an actionable, specific error instead of a
   * certificate that only fails once {@link SifenConnectionService} tries to connect with it.
   */
  private static void validateTablaERequirements(X509Certificate certificate) {
    PublicKey publicKey = certificate.getPublicKey();
    if (!(publicKey instanceof RSAPublicKey rsaPublicKey)) {
      // Tabla E only allows RSA — any other algorithm (e.g. EC) is non-conformant by definition.
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SIFEN_CERT_INVALID_KEY_SIZE");
    }
    int keySizeBits = rsaPublicKey.getModulus().bitLength();
    if (keySizeBits != 2048 && keySizeBits != 4096) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SIFEN_CERT_INVALID_KEY_SIZE");
    }

    try {
      List<String> extendedKeyUsage = certificate.getExtendedKeyUsage();
      if (extendedKeyUsage == null || !extendedKeyUsage.contains(CLIENT_AUTH_EKU_OID)) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SIFEN_CERT_MISSING_CLIENT_AUTH");
      }
    } catch (CertificateParsingException e) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SIFEN_CERT_MISSING_CLIENT_AUTH");
    }
  }

  private static String findFirstAlias(KeyStore keyStore) {
    try {
      var aliases = keyStore.aliases();
      if (!aliases.hasMoreElements()) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SIFEN_CERT_INVALID_FILE");
      }
      return aliases.nextElement();
    } catch (GeneralSecurityException e) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SIFEN_CERT_INVALID_FILE");
    }
  }

  private static LocalDate toLocalDate(java.util.Date date) {
    return date.toInstant().atZone(ZoneOffset.UTC).toLocalDate();
  }

  /** HU-20: computed fresh on every read from notBefore/notAfter — never persisted (AC-04). */
  private static SifenCertificateStatus computeStatus(SifenCertificate c, LocalDate today) {
    if (today.isBefore(c.getNotBefore())) {
      return SifenCertificateStatus.NOT_YET_VALID;
    }
    if (today.isAfter(c.getNotAfter())) {
      return SifenCertificateStatus.EXPIRED;
    }
    return SifenCertificateStatus.VALID;
  }

  private static SifenCertificateResponse toDto(SifenCertificate c, LocalDate today) {
    return new SifenCertificateResponse(
        c.getId(), c.getUploadedAt(), c.getNotBefore(), c.getNotAfter(), computeStatus(c, today));
  }
}
