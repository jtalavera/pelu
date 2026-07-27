package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.SifenCertificate;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.SifenCertificateRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.SifenCertificateResponse;
import com.cursorpoc.backend.web.dto.SifenCertificateUploadRequest;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.security.UnrecoverableKeyException;
import java.security.cert.X509Certificate;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Base64;
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

  private final TenantRepository tenantRepository;
  private final AppUserRepository appUserRepository;
  private final SifenCertificateRepository sifenCertificateRepository;
  private final SifenCertificateEncryptionService encryptionService;

  public SifenCertificateService(
      TenantRepository tenantRepository,
      AppUserRepository appUserRepository,
      SifenCertificateRepository sifenCertificateRepository,
      SifenCertificateEncryptionService encryptionService) {
    this.tenantRepository = tenantRepository;
    this.appUserRepository = appUserRepository;
    this.sifenCertificateRepository = sifenCertificateRepository;
    this.encryptionService = encryptionService;
  }

  @Transactional(readOnly = true)
  public List<SifenCertificateResponse> list(long tenantId) {
    return sifenCertificateRepository.findByTenant_IdOrderByUploadedAtDesc(tenantId).stream()
        .map(SifenCertificateService::toDto)
        .collect(Collectors.toList());
  }

  @Transactional
  public SifenCertificateResponse upload(
      long tenantId, long uploadedByUserId, SifenCertificateUploadRequest request) {
    byte[] fileBytes = decodeFile(request.fileBase64());
    X509Certificate leafCertificate = parseAndValidate(fileBytes, request.password());

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
    return toDto(entity);
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

  private static SifenCertificateResponse toDto(SifenCertificate c) {
    return new SifenCertificateResponse(
        c.getId(), c.getUploadedAt(), c.getNotBefore(), c.getNotAfter());
  }
}
