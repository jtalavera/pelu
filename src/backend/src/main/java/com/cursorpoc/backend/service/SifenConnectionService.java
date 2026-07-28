package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.SifenConnectionProperties;
import com.cursorpoc.backend.domain.BusinessProfile;
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.security.cert.CertificateParsingException;
import java.security.cert.X509Certificate;
import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.HexFormat;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-05: establishes an authenticated, mutual-TLS connection to SIFEN using the tenant's active
 * certificate (HU-21), before any document is sent (HU-06 and later).
 *
 * <p>Verified empirically (2026-07-28) against the real {@code sifen-test.set.gov.py}: the server
 * requests a client certificate during the TLS handshake; without one trusted by SIFEN, the request
 * is redirected (HTTP 302, {@code Location} containing {@code /vdesk/hangup}) rather than rejected
 * at the TLS layer itself — the handshake completes either way, so success/failure is determined
 * from the HTTP response, not from catching a TLS exception.
 */
@Service
public class SifenConnectionService {

  private static final Logger log = LoggerFactory.getLogger(SifenConnectionService.class);

  /**
   * The synchronous "recepción de DE" service (HU-06 will POST SOAP requests here); fetching its
   * WSDL is what HU-05 uses as the connectivity check. The technical manual's test-environment URL
   * for this path has a typo ({@code recibe.wsd?wsdl}, missing the final "l") — the real server was
   * confirmed live to serve the same {@code recibe.wsdl?wsdl} path as production.
   */
  private static final String SYNC_RECIBE_WSDL_PATH = "/de/ws/sync/recibe.wsdl?wsdl";

  private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(10);

  /** RFC 2253 directoryName SANs render unrecognized OIDs as {@code 2.5.4.5=#<hex DER>}. */
  private static final Pattern SERIAL_NUMBER_OID_PATTERN =
      Pattern.compile("2\\.5\\.4\\.5=#([0-9a-fA-F]+)");

  private static final int SAN_TYPE_DIRECTORY_NAME = 4;

  private final SifenCertificateService certificateService;
  private final BusinessProfileRepository businessProfileRepository;
  private final SifenConnectionProperties connectionProperties;

  public SifenConnectionService(
      SifenCertificateService certificateService,
      BusinessProfileRepository businessProfileRepository,
      SifenConnectionProperties connectionProperties) {
    this.certificateService = certificateService;
    this.businessProfileRepository = businessProfileRepository;
    this.connectionProperties = connectionProperties;
  }

  /**
   * AC-01/AC-06: resolves the tenant's active certificate (HU-21) and connects with it. AC-02:
   * rejected before any network call if the certificate's RUC doesn't match the tenant's configured
   * RUC. AC-04: environment comes entirely from {@link SifenConnectionProperties}. AC-05: every
   * attempt is logged with environment and outcome.
   */
  public SifenConnectionResult connect(long tenantId) {
    return connect(tenantId, null);
  }

  /**
   * Package-private overload letting tests point TLS trust at a local mock server's certificate
   * instead of the JVM's default CA trust store, so the mTLS request/response handling can be
   * exercised end to end without depending on SIFEN's real test environment.
   */
  SifenConnectionResult connect(long tenantId, javax.net.ssl.TrustManager[] testTrustManagers) {
    SifenActiveCertificateMaterial material = certificateService.requireActiveCertificate(tenantId);
    var environment = connectionProperties.activeEnvironment();

    validateRucMatches(tenantId, material.certificate());

    try {
      HttpClient client = buildMutualTlsClient(material, testTrustManagers);
      HttpRequest request =
          HttpRequest.newBuilder(
                  URI.create(connectionProperties.activeBaseUrl() + SYNC_RECIBE_WSDL_PATH))
              .timeout(CONNECT_TIMEOUT)
              .GET()
              .build();
      HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());

      if (response.statusCode() != 200) {
        log.error(
            "SIFEN connection rejected tenantId={} environment={} certificateId={} httpStatus={}",
            tenantId,
            environment,
            material.certificateId(),
            response.statusCode());
        throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "SIFEN_CONNECTION_REJECTED");
      }

      log.info(
          "SIFEN connection established tenantId={} environment={} certificateId={}",
          tenantId,
          environment,
          material.certificateId());
      return new SifenConnectionResult(environment, Instant.now());
    } catch (IOException | InterruptedException | GeneralSecurityException e) {
      if (Thread.currentThread().isInterrupted()) {
        Thread.currentThread().interrupt();
      }
      log.error(
          "SIFEN connection failed tenantId={} environment={} certificateId={} error={}",
          tenantId,
          environment,
          material.certificateId(),
          e.toString());
      throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "SIFEN_CONNECTION_REJECTED");
    }
  }

  private void validateRucMatches(long tenantId, X509Certificate certificate) {
    String certificateRuc = extractRuc(certificate);
    String tenantRuc =
        businessProfileRepository
            .findByTenantId(tenantId)
            .map(BusinessProfile::getRuc)
            .orElse(null);

    if (certificateRuc == null || tenantRuc == null || !certificateRuc.equals(tenantRuc.trim())) {
      log.error(
          "SIFEN connection rejected tenantId={} reason=ruc_mismatch certificateRuc={} tenantRuc={}",
          tenantId,
          certificateRuc,
          tenantRuc);
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "SIFEN_CERT_RUC_MISMATCH");
    }
  }

  private static HttpClient buildMutualTlsClient(
      SifenActiveCertificateMaterial material, javax.net.ssl.TrustManager[] trustManagers)
      throws GeneralSecurityException {
    KeyManagerFactory keyManagerFactory =
        KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
    keyManagerFactory.init(material.keyStore(), material.keystorePassword().toCharArray());

    // TLS 1.2 with mutual authentication is the standard mandated by the technical manual
    // (section 7.9) and confirmed live against the real test environment. `trustManagers` is null
    // in production, meaning "use the JVM's default CA trust store" (which already trusts SIFEN's
    // real, DigiCert-issued server certificate).
    SSLContext sslContext = SSLContext.getInstance("TLSv1.2");
    sslContext.init(keyManagerFactory.getKeyManagers(), trustManagers, new SecureRandom());

    return HttpClient.newBuilder().sslContext(sslContext).connectTimeout(CONNECT_TIMEOUT).build();
  }

  /**
   * Extracts the RUC embedded in the certificate's Subject Alternative Name (a directoryName entry
   * whose {@code serialNumber} attribute, OID 2.5.4.5, holds {@code RUC<value>} as a DER
   * PrintableString) — the standard place Paraguayan qualified certificates carry it. Returns
   * {@code null} if absent, which {@link #validateRucMatches} treats as a mismatch.
   */
  static String extractRuc(X509Certificate certificate) {
    try {
      Collection<List<?>> sans = certificate.getSubjectAlternativeNames();
      if (sans == null) {
        return null;
      }
      for (List<?> san : sans) {
        if (!(san.get(0) instanceof Integer type) || type != SAN_TYPE_DIRECTORY_NAME) {
          continue;
        }
        String ruc = extractRucFromDirectoryName(String.valueOf(san.get(1)));
        if (ruc != null) {
          return ruc;
        }
      }
      return null;
    } catch (CertificateParsingException e) {
      return null;
    }
  }

  /** Package-private for direct unit testing without needing a real certificate. */
  static String extractRucFromDirectoryName(String rawDirectoryName) {
    Matcher matcher = SERIAL_NUMBER_OID_PATTERN.matcher(rawDirectoryName);
    if (!matcher.find()) {
      return null;
    }
    byte[] der = HexFormat.of().parseHex(matcher.group(1));
    // Short-form DER PrintableString/UTF8String: byte[0]=tag, byte[1]=length (<128), then content.
    int length = der[1] & 0xFF;
    String value = new String(der, 2, length, java.nio.charset.StandardCharsets.UTF_8);
    return value.startsWith("RUC") ? value.substring(3) : value;
  }
}
