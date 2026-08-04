package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.config.SifenConnectionProperties;
import com.cursorpoc.backend.config.SifenConnectionProperties.Environment;
import com.cursorpoc.backend.domain.BusinessProfile;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import com.cursorpoc.backend.testsupport.LogCapture;
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
 * Exercises {@link SifenDocumentReceptionClient} against a local mock HTTPS server standing in for
 * SIFEN's synchronous reception service, reproducing the exact response shapes observed live
 * against sifen-test.set.gov.py on 2026-07-28 (see the class Javadoc for details): dEstRes as a
 * direct child of rProtDe, one or more repeated gResProc siblings, and HTTP status not reliably
 * indicating acceptance vs. rejection.
 */
@ExtendWith(MockitoExtension.class)
class SifenDocumentReceptionClientTest {

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
  void send_parsesRejectedResponse_withHttp400AndASingleGResProc() throws Exception {
    // Verified live: malformed SOAP body -> HTTP 400, one gResProc.
    String responseBody =
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body>\
        <ns2:rRetEnviDe xmlns:ns2="http://ekuatia.set.gov.py/sifen/xsd"><ns2:rProtDe>\
        <ns2:dFecProc>2026-07-28T12:12:15-03:00</ns2:dFecProc><ns2:dEstRes>Rechazado</ns2:dEstRes>\
        <ns2:gResProc><ns2:dCodRes>0160</ns2:dCodRes><ns2:dMsgRes>XML Mal Formado.</ns2:dMsgRes>\
        </ns2:gResProc></ns2:rProtDe></ns2:rRetEnviDe></env:Body></env:Envelope>""";
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    mockServer = startMockServer(material, 400, req -> responseBody);
    var client = newClient(material, mockServer.getAddress().getPort());

    Optional<SifenSubmissionResult> result = client.send(1L, "<rDE/>", trustManagersFor(material));

    assertThat(result).isPresent();
    assertThat(result.get().status()).isEqualTo(SifenSubmissionStatus.REJECTED);
    assertThat(result.get().resultCode()).isEqualTo("0160");
    assertThat(result.get().message()).isEqualTo("XML Mal Formado.");
    assertThat(result.get().protocolNumber()).isNull();
  }

  @Test
  void send_joinsMultipleGResProcMessages_whenSifenReturnsSeveralValidationErrors()
      throws Exception {
    // Verified live: a well-formed but schema-invalid document -> HTTP 200, four gResProc entries.
    String responseBody =
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body>\
        <ns2:rRetEnviDe xmlns:ns2="http://ekuatia.set.gov.py/sifen/xsd"><ns2:rProtDe>\
        <ns2:Id>01011371528001001000000122026072817606765985</ns2:Id>\
        <ns2:dFecProc>2026-07-28T12:15:07-03:00</ns2:dFecProc><ns2:dEstRes>Rechazado</ns2:dEstRes>\
        <ns2:gResProc><ns2:dCodRes>0160</ns2:dCodRes>\
        <ns2:dMsgRes>Primer error</ns2:dMsgRes></ns2:gResProc>\
        <ns2:gResProc><ns2:dCodRes>0161</ns2:dCodRes>\
        <ns2:dMsgRes>Segundo error</ns2:dMsgRes></ns2:gResProc>\
        </ns2:rProtDe></ns2:rRetEnviDe></env:Body></env:Envelope>""";
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    mockServer = startMockServer(material, 200, req -> responseBody);
    var client = newClient(material, mockServer.getAddress().getPort());

    Optional<SifenSubmissionResult> result = client.send(1L, "<rDE/>", trustManagersFor(material));

    assertThat(result).isPresent();
    assertThat(result.get().status()).isEqualTo(SifenSubmissionStatus.REJECTED);
    assertThat(result.get().resultCode()).isEqualTo("0160");
    assertThat(result.get().message()).isEqualTo("Primer error; Segundo error");
  }

  @Test
  void send_parsesApprovedResponse_withProtocolNumber() throws Exception {
    String responseBody =
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body>\
        <ns2:rRetEnviDe xmlns:ns2="http://ekuatia.set.gov.py/sifen/xsd"><ns2:rProtDe>\
        <ns2:Id>01011371528001001000000122026072817606765985</ns2:Id>\
        <ns2:dFecProc>2026-07-28T12:15:07-03:00</ns2:dFecProc>\
        <ns2:dDigVal>abc123==</ns2:dDigVal><ns2:dEstRes>Aprobado</ns2:dEstRes>\
        <ns2:gResProc><ns2:dProtAut>1234567890</ns2:dProtAut>\
        <ns2:dCodRes>0260</ns2:dCodRes><ns2:dMsgRes>Autorizado</ns2:dMsgRes></ns2:gResProc>\
        </ns2:rProtDe></ns2:rRetEnviDe></env:Body></env:Envelope>""";
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    mockServer = startMockServer(material, 200, req -> responseBody);
    var client = newClient(material, mockServer.getAddress().getPort());

    Optional<SifenSubmissionResult> result = client.send(1L, "<rDE/>", trustManagersFor(material));

    assertThat(result).isPresent();
    assertThat(result.get().status()).isEqualTo(SifenSubmissionStatus.APPROVED);
    assertThat(result.get().protocolNumber()).isEqualTo("1234567890");
  }

  @Test
  void send_logsSifenReqAndRespLines_withOperationCodeAndMessage() throws Exception {
    String responseBody =
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body>\
        <ns2:rRetEnviDe xmlns:ns2="http://ekuatia.set.gov.py/sifen/xsd"><ns2:rProtDe>\
        <ns2:Id>01011371528001001000000122026072817606765985</ns2:Id>\
        <ns2:dFecProc>2026-07-28T12:15:07-03:00</ns2:dFecProc>\
        <ns2:dDigVal>abc123==</ns2:dDigVal><ns2:dEstRes>Aprobado</ns2:dEstRes>\
        <ns2:gResProc><ns2:dProtAut>1234567890</ns2:dProtAut>\
        <ns2:dCodRes>0260</ns2:dCodRes><ns2:dMsgRes>Autorizado</ns2:dMsgRes></ns2:gResProc>\
        </ns2:rProtDe></ns2:rRetEnviDe></env:Body></env:Envelope>""";
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    mockServer = startMockServer(material, 200, req -> responseBody);
    var client = newClient(material, mockServer.getAddress().getPort());

    try (LogCapture logs = new LogCapture(SifenDocumentReceptionClient.class)) {
      client.send(1L, "<rDE/>", trustManagersFor(material));

      assertThat(logs.messages())
          .anyMatch(
              m -> m.startsWith("[SIFEN req] operation=SiRecepDE") && m.contains("tenantId=1"));
      assertThat(logs.messages())
          .anyMatch(
              m ->
                  m.startsWith("[SIFEN resp] operation=SiRecepDE")
                      && m.contains("code=0260")
                      && m.contains("message=Autorizado"));
    }
  }

  @Test
  void send_parsesApprovedWithObservationResponse() throws Exception {
    String responseBody =
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body>\
        <ns2:rRetEnviDe xmlns:ns2="http://ekuatia.set.gov.py/sifen/xsd"><ns2:rProtDe>\
        <ns2:dEstRes>Aprobado con observación</ns2:dEstRes>\
        <ns2:gResProc><ns2:dProtAut>9999999999</ns2:dProtAut>\
        <ns2:dCodRes>0301</ns2:dCodRes><ns2:dMsgRes>Observación menor</ns2:dMsgRes></ns2:gResProc>\
        </ns2:rProtDe></ns2:rRetEnviDe></env:Body></env:Envelope>""";
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    mockServer = startMockServer(material, 200, req -> responseBody);
    var client = newClient(material, mockServer.getAddress().getPort());

    Optional<SifenSubmissionResult> result = client.send(1L, "<rDE/>", trustManagersFor(material));

    assertThat(result).isPresent();
    assertThat(result.get().status()).isEqualTo(SifenSubmissionStatus.APPROVED_WITH_OBSERVATION);
  }

  @Test
  void send_returnsEmpty_whenServerUnreachable() throws Exception {
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    var client = newClient(material, 1); // reserved port, nothing listens there

    Optional<SifenSubmissionResult> result = client.send(1L, "<rDE/>", null);

    assertThat(result).isEmpty();
  }

  @Test
  void send_returnsEmpty_whenResponseBodyIsUnparseable() throws Exception {
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    mockServer = startMockServer(material, 200, req -> "not xml at all");
    var client = newClient(material, mockServer.getAddress().getPort());

    Optional<SifenSubmissionResult> result = client.send(1L, "<rDE/>", trustManagersFor(material));

    assertThat(result).isEmpty();
  }

  @Test
  void send_wrapsTheSignedDocumentInASoapEnvelopeWithRequiredElements() throws Exception {
    String responseBody =
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body>\
        <ns2:rRetEnviDe xmlns:ns2="http://ekuatia.set.gov.py/sifen/xsd"><ns2:rProtDe>\
        <ns2:dEstRes>Rechazado</ns2:dEstRes><ns2:gResProc><ns2:dCodRes>0160</ns2:dCodRes>\
        <ns2:dMsgRes>x</ns2:dMsgRes></ns2:gResProc></ns2:rProtDe></ns2:rRetEnviDe>\
        </env:Body></env:Envelope>""";
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

    client.send(1L, "<rDE Id=\"cdc\"><dVerFor>150</dVerFor></rDE>", trustManagersFor(material));

    String sent = capturedRequest.toString();
    assertThat(sent).contains("<soap:Envelope");
    assertThat(sent).contains("<rEnviDe xmlns=\"http://ekuatia.set.gov.py/sifen/xsd\">");
    assertThat(sent).contains("<dId>");
    assertThat(sent).contains("<xDE><rDE Id=\"cdc\">");
  }

  private SifenDocumentReceptionClient newClient(
      SifenActiveCertificateMaterial material, int port) {
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
    return new SifenDocumentReceptionClient(
        connectionService, connectionProperties, new FemmeTimeProperties());
  }

  private static SifenActiveCertificateMaterial loadMaterial(String resourcePath, String password)
      throws Exception {
    byte[] bytes =
        Files.readAllBytes(
            Path.of(
                SifenDocumentReceptionClientTest.class
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
        "/de/ws/sync/recibe.wsdl",
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
