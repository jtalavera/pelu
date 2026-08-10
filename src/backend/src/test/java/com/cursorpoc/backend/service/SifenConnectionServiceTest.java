package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.SifenConnectionProperties;
import com.cursorpoc.backend.config.SifenConnectionProperties.Environment;
import com.cursorpoc.backend.domain.BusinessProfile;
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import com.cursorpoc.backend.testsupport.LogCapture;
import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsServer;
import java.io.ByteArrayInputStream;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.Optional;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;

/**
 * Exercises the real mTLS request/response handling end to end against a local {@link HttpsServer}
 * standing in for SIFEN, so no test depends on external network access. The mock server's behavior
 * (200 vs the real 302-to-"/vdesk/hangup" observed empirically against the live
 * sifen-test.set.gov.py — see SifenConnectionService's class Javadoc) is what proves the
 * classification logic, not just the plumbing.
 */
@ExtendWith(MockitoExtension.class)
class SifenConnectionServiceTest {

  private static final String RUC_MATCHING_TENANT = "12345678-9";

  @Mock private SifenCertificateService certificateService;
  @Mock private BusinessProfileRepository businessProfileRepository;

  private HttpsServer mockServer;

  @AfterEach
  void tearDown() {
    if (mockServer != null) {
      mockServer.stop(0);
    }
  }

  @Test
  void connect_succeeds_whenRucMatchesAndServerRespondsOk() throws Exception {
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    mockServer = startMockServer(material, 200, null);

    var service = newService(mockServer.getAddress().getPort());
    when(certificateService.requireActiveCertificate(1L)).thenReturn(material);
    when(businessProfileRepository.findByTenantId(1L))
        .thenReturn(Optional.of(businessProfileWithRuc(RUC_MATCHING_TENANT)));

    SifenConnectionResult result = service.connect(1L, trustManagersFor(material.certificate()));

    assertThat(result.environment()).isEqualTo(Environment.TEST);
  }

  @Test
  void connect_logsSifenReqAndRespLines_withOperationAndHttpStatus() throws Exception {
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    mockServer = startMockServer(material, 200, null);

    var service = newService(mockServer.getAddress().getPort());
    when(certificateService.requireActiveCertificate(1L)).thenReturn(material);
    when(businessProfileRepository.findByTenantId(1L))
        .thenReturn(Optional.of(businessProfileWithRuc(RUC_MATCHING_TENANT)));

    try (LogCapture logs = new LogCapture(SifenConnectionService.class)) {
      service.connect(1L, trustManagersFor(material.certificate()));

      assertThat(logs.messages())
          .anyMatch(m -> m.startsWith("[SIFEN req] operation=connect") && m.contains("tenantId=1"));
      assertThat(logs.messages())
          .anyMatch(
              m -> m.startsWith("[SIFEN resp] operation=connect") && m.contains("httpStatus=200"));
    }
  }

  @Test
  void connect_rejectsConnection_whenServerRedirectsLikeRealSifenHangup() throws Exception {
    // The real sifen-test.set.gov.py does exactly this (HTTP 302, Location containing
    // /vdesk/hangup.php3) for a request it doesn't accept — verified live, see class Javadoc.
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    mockServer = startMockServer(material, 302, "/vdesk/hangup.php3");

    var service = newService(mockServer.getAddress().getPort());
    when(certificateService.requireActiveCertificate(1L)).thenReturn(material);
    when(businessProfileRepository.findByTenantId(1L))
        .thenReturn(Optional.of(businessProfileWithRuc(RUC_MATCHING_TENANT)));

    assertThatThrownBy(() -> service.connect(1L, trustManagersFor(material.certificate())))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_CONNECTION_REJECTED");
  }

  @Test
  void connect_rejectsBeforeAnyNetworkCall_whenCertificateHasNoRucExtension() throws Exception {
    // AC-02: this certificate (the HU-18 fixture) carries no RUC SAN at all, so the mismatch must
    // be caught before attempting the network call — proven by pointing at an address nothing is
    // listening on and still getting the RUC error, not a connection-failure error.
    SifenActiveCertificateMaterial material = loadMaterial("sifen/test-cert.p12", "TestPass123!");
    var service = newService(1);
    when(certificateService.requireActiveCertificate(1L)).thenReturn(material);
    when(businessProfileRepository.findByTenantId(1L))
        .thenReturn(Optional.of(businessProfileWithRuc(RUC_MATCHING_TENANT)));

    assertThatThrownBy(() -> service.connect(1L, null))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_CERT_RUC_MISMATCH");
  }

  @Test
  void connect_rejectsBeforeAnyNetworkCall_whenTenantHasNoConfiguredRuc() throws Exception {
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    var service = newService(1);
    when(certificateService.requireActiveCertificate(1L)).thenReturn(material);
    when(businessProfileRepository.findByTenantId(1L)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.connect(1L, null))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_CERT_RUC_MISMATCH");
  }

  @Test
  void connect_mapsNetworkFailureToRejected_whenHostUnreachable() throws Exception {
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    // Port 1 on loopback: reserved, nothing ever listens there — a fast, deterministic "connection
    // refused" without needing a real unreachable host.
    var service = newService(1);
    when(certificateService.requireActiveCertificate(1L)).thenReturn(material);
    when(businessProfileRepository.findByTenantId(1L))
        .thenReturn(Optional.of(businessProfileWithRuc(RUC_MATCHING_TENANT)));

    assertThatThrownBy(() -> service.connect(1L, trustManagersFor(material.certificate())))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_CONNECTION_REJECTED");
  }

  @Test
  void extractRucFromDirectoryName_parsesRucFromDerEncodedSerialNumber() {
    // "RUC99999999-9" DER-encoded (PrintableString: tag 0x13, length 13) — a fabricated value, not
    // derived from any real certificate.
    String rawDirectoryName = "2.5.4.5=#130d52554339393939393939392d39,O=Fake Test Org";
    assertThat(SifenConnectionService.extractRucFromDirectoryName(rawDirectoryName))
        .isEqualTo("99999999-9");
  }

  @Test
  void extractRucFromDirectoryName_returnsNull_whenNoSerialNumberOid() {
    assertThat(SifenConnectionService.extractRucFromDirectoryName("O=Fake Test Org")).isNull();
  }

  @Test
  void extractRuc_returnsNull_whenCertificateHasNoSubjectAlternativeNames() throws Exception {
    X509Certificate cert = loadMaterial("sifen/test-cert.p12", "TestPass123!").certificate();
    assertThat(SifenConnectionService.extractRuc(cert)).isNull();
  }

  private SifenConnectionService newService(int port) {
    SifenConnectionProperties properties = new SifenConnectionProperties();
    properties.setEnvironment(Environment.TEST);
    properties.setTestBaseUrl("https://127.0.0.1:" + port);
    return new SifenConnectionService(certificateService, businessProfileRepository, properties);
  }

  private static BusinessProfile businessProfileWithRuc(String ruc) {
    BusinessProfile profile = new BusinessProfile();
    profile.setRuc(ruc);
    return profile;
  }

  private static SifenActiveCertificateMaterial loadMaterial(String resourcePath, String password)
      throws Exception {
    byte[] bytes =
        Files.readAllBytes(
            Path.of(
                SifenConnectionServiceTest.class
                    .getClassLoader()
                    .getResource(resourcePath)
                    .getPath()));
    KeyStore keyStore = KeyStore.getInstance("PKCS12");
    keyStore.load(new ByteArrayInputStream(bytes), password.toCharArray());
    String alias = keyStore.aliases().nextElement();
    X509Certificate certificate = (X509Certificate) keyStore.getCertificate(alias);
    PrivateKey privateKey = (PrivateKey) keyStore.getKey(alias, password.toCharArray());
    return new SifenActiveCertificateMaterial(
        1L, keyStore, password, alias, certificate, privateKey);
  }

  private static TrustManager[] trustManagersFor(X509Certificate certificate) throws Exception {
    KeyStore trustStore = KeyStore.getInstance("PKCS12");
    trustStore.load(null, null);
    trustStore.setCertificateEntry("mock-server", certificate);
    TrustManagerFactory trustManagerFactory =
        TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
    trustManagerFactory.init(trustStore);
    return trustManagerFactory.getTrustManagers();
  }

  /**
   * A local HTTPS server standing in for SIFEN, presenting {@code material}'s certificate as its
   * own server identity (self-signed, reused for simplicity — this test isn't exercising SIFEN's
   * server-identity validation, which is standard JVM trust-store behavior already verified live).
   */
  private static HttpsServer startMockServer(
      SifenActiveCertificateMaterial material, int responseStatus, String redirectLocation)
      throws Exception {
    KeyManagerFactory keyManagerFactory =
        KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
    keyManagerFactory.init(material.keyStore(), material.keystorePassword().toCharArray());
    SSLContext serverContext = SSLContext.getInstance("TLSv1.2");
    serverContext.init(keyManagerFactory.getKeyManagers(), null, new SecureRandom());

    HttpsServer server = HttpsServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.setHttpsConfigurator(new HttpsConfigurator(serverContext));
    server.createContext(
        "/de/ws/sync/recibe.wsdl",
        exchange -> {
          if (redirectLocation != null) {
            exchange.getResponseHeaders().add("Location", redirectLocation);
          }
          byte[] body =
              responseStatus == 200
                  ? "<wsdl:definitions/>".getBytes(java.nio.charset.StandardCharsets.UTF_8)
                  : new byte[0];
          exchange.sendResponseHeaders(responseStatus, body.length);
          exchange.getResponseBody().write(body);
          exchange.close();
        });
    server.start();
    return server;
  }
}
