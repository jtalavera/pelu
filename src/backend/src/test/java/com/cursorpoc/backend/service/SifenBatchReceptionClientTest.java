package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.SifenConnectionProperties;
import com.cursorpoc.backend.config.SifenConnectionProperties.Environment;
import com.cursorpoc.backend.domain.BusinessProfile;
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsServer;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import java.util.function.Function;
import java.util.zip.ZipInputStream;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * Exercises {@link SifenBatchReceptionClient} both against a local mock HTTPS server (real-shaped
 * responses observed live, see the class Javadoc) and directly, for the zip/Base64 payload building
 * logic that doesn't need a server at all.
 */
@ExtendWith(MockitoExtension.class)
class SifenBatchReceptionClientTest {

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
  void buildCompressedLotePayload_zipsAndBase64EncodesARLoteDeWrappingEveryDocument()
      throws Exception {
    String base64Zip =
        SifenBatchReceptionClient.buildCompressedLotePayload(
            List.of("<rDE Id=\"cdc1\"/>", "<rDE Id=\"cdc2\"/>"));

    byte[] zipBytes = Base64.getDecoder().decode(base64Zip);
    String unzipped;
    try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(zipBytes))) {
      var entry = zis.getNextEntry();
      assertThat(entry).isNotNull();
      unzipped = new String(zis.readAllBytes(), StandardCharsets.UTF_8);
    }

    assertThat(unzipped).startsWith("<rLoteDE xmlns=\"http://ekuatia.set.gov.py/sifen/xsd\">");
    assertThat(unzipped).contains("<rDE Id=\"cdc1\"/>");
    assertThat(unzipped).contains("<rDE Id=\"cdc2\"/>");
    assertThat(unzipped).endsWith("</rLoteDE>");
  }

  @Test
  void send_parsesAcceptedResponse_withBatchNumberAndRecommendedWait() throws Exception {
    // Shape confirmed live (2026-07-28) against the real resRecepLoteDE XSD: BF01 dCodRes=0300.
    String responseBody =
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body>\
        <ns2:rResEnviLoteDe xmlns:ns2="http://ekuatia.set.gov.py/sifen/xsd">\
        <ns2:dFecProc>2026-07-28T12:15:07-03:00</ns2:dFecProc>\
        <ns2:dCodRes>0300</ns2:dCodRes><ns2:dMsgRes>Lote recibido con éxito</ns2:dMsgRes>\
        <ns2:dProtConsLote>1234567890123</ns2:dProtConsLote><ns2:dTpoProces>12</ns2:dTpoProces>\
        </ns2:rResEnviLoteDe></env:Body></env:Envelope>""";
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    mockServer = startMockServer(material, 200, req -> responseBody);
    var client = newClient(material, mockServer.getAddress().getPort());

    Optional<SifenBatchSubmissionResult> result =
        client.send(1L, List.of("<rDE/>", "<rDE/>"), trustManagersFor(material));

    assertThat(result).isPresent();
    assertThat(result.get().accepted()).isTrue();
    assertThat(result.get().resultCode()).isEqualTo("0300");
    assertThat(result.get().batchNumber()).isEqualTo("1234567890123");
    assertThat(result.get().recommendedWaitSeconds()).isEqualTo(12);
  }

  @Test
  void send_parsesRejectedResponse_withNoBatchNumber() throws Exception {
    // BF02: dCodRes=0301 "Lote no encolado para procesamiento" — sección 12.3.2.3.
    String responseBody =
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body>\
        <ns2:rResEnviLoteDe xmlns:ns2="http://ekuatia.set.gov.py/sifen/xsd">\
        <ns2:dCodRes>0301</ns2:dCodRes>\
        <ns2:dMsgRes>Lote no encolado para procesamiento</ns2:dMsgRes>\
        </ns2:rResEnviLoteDe></env:Body></env:Envelope>""";
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    mockServer = startMockServer(material, 200, req -> responseBody);
    var client = newClient(material, mockServer.getAddress().getPort());

    Optional<SifenBatchSubmissionResult> result =
        client.send(1L, List.of("<rDE/>"), trustManagersFor(material));

    assertThat(result).isPresent();
    assertThat(result.get().accepted()).isFalse();
    assertThat(result.get().resultCode()).isEqualTo("0301");
    assertThat(result.get().batchNumber()).isNull();
  }

  @Test
  void send_returnsEmpty_whenServerUnreachable() throws Exception {
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    var client = newClient(material, 1); // reserved port, nothing listens there

    Optional<SifenBatchSubmissionResult> result = client.send(1L, List.of("<rDE/>"), null);

    assertThat(result).isEmpty();
  }

  @Test
  void send_returnsEmpty_whenResponseBodyIsUnparseable() throws Exception {
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    mockServer = startMockServer(material, 200, req -> "not xml at all");
    var client = newClient(material, mockServer.getAddress().getPort());

    Optional<SifenBatchSubmissionResult> result =
        client.send(1L, List.of("<rDE/>"), trustManagersFor(material));

    assertThat(result).isEmpty();
  }

  @Test
  void send_wrapsTheCompressedBatchInASoapEnvelopeWithRequiredElements() throws Exception {
    String responseBody =
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body>\
        <ns2:rResEnviLoteDe xmlns:ns2="http://ekuatia.set.gov.py/sifen/xsd">\
        <ns2:dCodRes>0300</ns2:dCodRes><ns2:dMsgRes>x</ns2:dMsgRes>\
        <ns2:dProtConsLote>1</ns2:dProtConsLote></ns2:rResEnviLoteDe></env:Body></env:Envelope>""";
    StringBuilder capturedRequest = new StringBuilder();
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    mockServer =
        startMockServer(
            material,
            200,
            req -> {
              capturedRequest.append(req);
              return responseBody;
            });
    var client = newClient(material, mockServer.getAddress().getPort());

    client.send(1L, List.of("<rDE Id=\"cdc\"/>"), trustManagersFor(material));

    String sent = capturedRequest.toString();
    assertThat(sent).contains("<soap:Envelope");
    assertThat(sent).contains("<rEnvioLote xmlns=\"http://ekuatia.set.gov.py/sifen/xsd\">");
    assertThat(sent).contains("<dId>");
    assertThat(sent).contains("<xDE>");
  }

  private SifenBatchReceptionClient newClient(SifenActiveCertificateMaterial material, int port) {
    when(certificateService.requireActiveCertificate(1L)).thenReturn(material);
    BusinessProfile profile = new BusinessProfile();
    profile.setRuc(RUC_MATCHING_TENANT);
    when(businessProfileRepository.findByTenantId(1L)).thenReturn(java.util.Optional.of(profile));
    SifenConnectionProperties connectionProperties = new SifenConnectionProperties();
    connectionProperties.setEnvironment(Environment.TEST);
    connectionProperties.setTestBaseUrl("https://127.0.0.1:" + port);
    SifenConnectionService connectionService =
        new SifenConnectionService(
            certificateService, businessProfileRepository, connectionProperties);
    return new SifenBatchReceptionClient(connectionService, connectionProperties);
  }

  private static SifenActiveCertificateMaterial loadMaterial(String resourcePath, String password)
      throws Exception {
    byte[] bytes =
        Files.readAllBytes(
            Path.of(
                SifenBatchReceptionClientTest.class
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

  private static TrustManager[] trustManagersFor(SifenActiveCertificateMaterial material)
      throws Exception {
    KeyStore trustStore = KeyStore.getInstance("PKCS12");
    trustStore.load(null, null);
    trustStore.setCertificateEntry("mock-server", material.certificate());
    TrustManagerFactory trustManagerFactory =
        TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
    trustManagerFactory.init(trustStore);
    return trustManagerFactory.getTrustManagers();
  }

  private static HttpsServer startMockServer(
      SifenActiveCertificateMaterial material,
      int responseStatus,
      Function<String, String> responseForRequest)
      throws Exception {
    KeyManagerFactory keyManagerFactory =
        KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
    keyManagerFactory.init(material.keyStore(), material.keystorePassword().toCharArray());
    SSLContext serverContext = SSLContext.getInstance("TLSv1.2");
    serverContext.init(keyManagerFactory.getKeyManagers(), null, new SecureRandom());

    HttpsServer server = HttpsServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.setHttpsConfigurator(new HttpsConfigurator(serverContext));
    server.createContext(
        "/de/ws/async/recibe-lote.wsdl",
        exchange -> {
          ByteArrayOutputStream requestBytes = new ByteArrayOutputStream();
          exchange.getRequestBody().transferTo(requestBytes);
          String requestBody = requestBytes.toString(StandardCharsets.UTF_8);
          byte[] body = responseForRequest.apply(requestBody).getBytes(StandardCharsets.UTF_8);
          exchange.sendResponseHeaders(responseStatus, body.length);
          exchange.getResponseBody().write(body);
          exchange.close();
        });
    server.start();
    return server;
  }
}
