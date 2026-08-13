package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.SifenConnectionProperties;
import com.cursorpoc.backend.config.SifenConnectionProperties.Environment;
import com.cursorpoc.backend.domain.BusinessProfile;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import com.cursorpoc.backend.testsupport.LogCapture;
import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsServer;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
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
import java.util.Optional;
import java.util.function.Function;
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
 * Exercises {@link SifenBatchResultQueryClient} against a local mock HTTPS server reproducing the
 * real {@code rResEnviConsLoteDe} response shapes confirmed live (see the class Javadoc): batch
 * still processing (0361), concluded with mixed per-document outcomes (0362), and a whole-batch
 * rejection for mixed document types (0363).
 */
@ExtendWith(MockitoExtension.class)
class SifenBatchResultQueryClientTest {

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
  void query_reportsStillProcessing_withNoDocuments() throws Exception {
    String responseBody =
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body>\
        <ns2:rResEnviConsLoteDe xmlns:ns2="http://ekuatia.set.gov.py/sifen/xsd">\
        <ns2:dFecProc></ns2:dFecProc><ns2:dCodResLot>0361</ns2:dCodResLot>\
        <ns2:dMsgResLot>Lote en procesamiento</ns2:dMsgResLot>\
        </ns2:rResEnviConsLoteDe></env:Body></env:Envelope>""";
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    mockServer = startMockServer(material, 200, req -> responseBody);
    var client = newClient(material, mockServer.getAddress().getPort());

    Optional<SifenBatchQueryResult> result =
        client.query(1L, "1234567890123", trustManagersFor(material));

    assertThat(result).isPresent();
    assertThat(result.get().stillProcessing()).isTrue();
    assertThat(result.get().concluded()).isFalse();
    assertThat(result.get().documents()).isEmpty();
  }

  @Test
  void query_logsSifenReqAndRespLines_withOperationBatchNumberCodeAndMessage() throws Exception {
    String batchNumber = "1234567890123";
    String responseBody =
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body>\
        <ns2:rResEnviConsLoteDe xmlns:ns2="http://ekuatia.set.gov.py/sifen/xsd">\
        <ns2:dFecProc></ns2:dFecProc><ns2:dCodResLot>0361</ns2:dCodResLot>\
        <ns2:dMsgResLot>Lote en procesamiento</ns2:dMsgResLot>\
        </ns2:rResEnviConsLoteDe></env:Body></env:Envelope>""";
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    mockServer = startMockServer(material, 200, req -> responseBody);
    var client = newClient(material, mockServer.getAddress().getPort());

    try (LogCapture logs = new LogCapture(SifenBatchResultQueryClient.class)) {
      client.query(1L, batchNumber, trustManagersFor(material));

      assertThat(logs.messages())
          .anyMatch(
              m ->
                  m.startsWith("[SIFEN req] operation=SiResultLoteDE")
                      && m.contains("tenantId=1")
                      && m.contains("batchNumber=" + batchNumber));
      assertThat(logs.messages())
          .anyMatch(
              m ->
                  m.startsWith("[SIFEN resp] operation=SiResultLoteDE")
                      && m.contains("code=0361")
                      && m.contains("message=Lote en procesamiento"));
    }
  }

  @Test
  void query_reportsConcludedBatch_withPerDocumentApprovedAndRejectedResults() throws Exception {
    String responseBody =
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body>\
        <ns2:rResEnviConsLoteDe xmlns:ns2="http://ekuatia.set.gov.py/sifen/xsd">\
        <ns2:dFecProc>2026-07-28T12:15:07-03:00</ns2:dFecProc>\
        <ns2:dCodResLot>0362</ns2:dCodResLot>\
        <ns2:dMsgResLot>Procesamiento de lote concluido</ns2:dMsgResLot>\
        <ns2:gResProcLote><ns2:id>CDC-APROBADO</ns2:id><ns2:dEstRes>Aprobado</ns2:dEstRes>\
        <ns2:dProtAut>1234567890</ns2:dProtAut>\
        <ns2:gResProc><ns2:dCodRes>0260</ns2:dCodRes><ns2:dMsgRes>Autorizado</ns2:dMsgRes>\
        </ns2:gResProc></ns2:gResProcLote>\
        <ns2:gResProcLote><ns2:id>CDC-RECHAZADO</ns2:id><ns2:dEstRes>Rechazado</ns2:dEstRes>\
        <ns2:gResProc><ns2:dCodRes>0160</ns2:dCodRes><ns2:dMsgRes>Primer error</ns2:dMsgRes>\
        </ns2:gResProc><ns2:gResProc><ns2:dCodRes>0161</ns2:dCodRes>\
        <ns2:dMsgRes>Segundo error</ns2:dMsgRes></ns2:gResProc></ns2:gResProcLote>\
        </ns2:rResEnviConsLoteDe></env:Body></env:Envelope>""";
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    mockServer = startMockServer(material, 200, req -> responseBody);
    var client = newClient(material, mockServer.getAddress().getPort());

    Optional<SifenBatchQueryResult> result =
        client.query(1L, "1234567890123", trustManagersFor(material));

    assertThat(result).isPresent();
    assertThat(result.get().concluded()).isTrue();
    assertThat(result.get().documents()).hasSize(2);

    SifenBatchDocumentResult approved = result.get().documents().get(0);
    assertThat(approved.cdc()).isEqualTo("CDC-APROBADO");
    assertThat(approved.status()).isEqualTo(SifenSubmissionStatus.APPROVED);
    assertThat(approved.resultCode()).isEqualTo("0260");

    SifenBatchDocumentResult rejected = result.get().documents().get(1);
    assertThat(rejected.cdc()).isEqualTo("CDC-RECHAZADO");
    assertThat(rejected.status()).isEqualTo(SifenSubmissionStatus.REJECTED);
    assertThat(rejected.resultCode()).isEqualTo("0160");
    assertThat(rejected.message()).isEqualTo("Primer error; Segundo error");
  }

  @Test
  void query_reportsWholeBatchRejection_forMixedDocumentTypes_withNoDocuments() throws Exception {
    // Manual Técnico V150 Tabla B104 / sección 12.3.3.3: dCodResLot=0363 "Lotes con tipos
    // distintos de DE" — HU-15 AC-05.
    String responseBody =
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body>\
        <ns2:rResEnviConsLoteDe xmlns:ns2="http://ekuatia.set.gov.py/sifen/xsd">\
        <ns2:dFecProc>2026-07-28T12:15:07-03:00</ns2:dFecProc>\
        <ns2:dCodResLot>0363</ns2:dCodResLot>\
        <ns2:dMsgResLot>Lotes con tipos distintos de DE</ns2:dMsgResLot>\
        </ns2:rResEnviConsLoteDe></env:Body></env:Envelope>""";
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    mockServer = startMockServer(material, 200, req -> responseBody);
    var client = newClient(material, mockServer.getAddress().getPort());

    Optional<SifenBatchQueryResult> result =
        client.query(1L, "1234567890123", trustManagersFor(material));

    assertThat(result).isPresent();
    assertThat(result.get().batchResultCode()).isEqualTo("0363");
    assertThat(result.get().concluded()).isFalse();
    assertThat(result.get().stillProcessing()).isFalse();
    assertThat(result.get().documents()).isEmpty();
  }

  @Test
  void query_returnsEmpty_whenServerUnreachable() throws Exception {
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    var client = newClient(material, 1); // reserved port, nothing listens there

    Optional<SifenBatchQueryResult> result = client.query(1L, "1", null);

    assertThat(result).isEmpty();
  }

  @Test
  void query_returnsEmpty_whenResponseBodyIsUnparseable() throws Exception {
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    mockServer = startMockServer(material, 200, req -> "not xml at all");
    var client = newClient(material, mockServer.getAddress().getPort());

    Optional<SifenBatchQueryResult> result =
        client.query(1L, "1234567890123", trustManagersFor(material));

    assertThat(result).isEmpty();
  }

  @Test
  void query_sendsTheBatchNumberInASoapEnvelopeWithRequiredElements() throws Exception {
    String responseBody =
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body>\
        <ns2:rResEnviConsLoteDe xmlns:ns2="http://ekuatia.set.gov.py/sifen/xsd">\
        <ns2:dCodResLot>0361</ns2:dCodResLot><ns2:dMsgResLot>x</ns2:dMsgResLot>\
        </ns2:rResEnviConsLoteDe></env:Body></env:Envelope>""";
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

    client.query(1L, "999999", trustManagersFor(material));

    String sent = capturedRequest.toString();
    assertThat(sent).contains("<soap:Envelope");
    assertThat(sent).contains("<rEnviConsLoteDe xmlns=\"http://ekuatia.set.gov.py/sifen/xsd\">");
    assertThat(sent).contains("<dId>");
    assertThat(sent).contains("<dProtConsLote>999999</dProtConsLote>");
  }

  private SifenBatchResultQueryClient newClient(SifenActiveCertificateMaterial material, int port) {
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
    return new SifenBatchResultQueryClient(connectionService, connectionProperties, testMetrics());
  }

  private static SifenCallMetrics testMetrics() {
    return new SifenCallMetrics(new SimpleMeterRegistry(), new SifenConnectionProperties());
  }

  private static SifenActiveCertificateMaterial loadMaterial(String resourcePath, String password)
      throws Exception {
    byte[] bytes =
        Files.readAllBytes(
            Path.of(
                SifenBatchResultQueryClientTest.class
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
        "/de/ws/consultas/consulta-lote.wsdl",
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
