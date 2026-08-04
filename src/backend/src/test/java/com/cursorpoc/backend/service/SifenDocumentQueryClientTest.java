package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

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
import org.springframework.web.server.ResponseStatusException;

/**
 * Exercises {@link SifenDocumentQueryClient} against a local mock HTTPS server standing in for
 * SIFEN's consulta (SiConsDE) service, reproducing the exact response shapes observed live against
 * sifen-test.set.gov.py on 2026-07-28 (see the class Javadoc for details): the real root elements
 * ({@code rEnviConsDeRequest}/{@code rEnviConsDeResponse}, not the manual's documented {@code
 * rEnviConsDe}/{@code rResEnviConsDe}), and dCodRes=0420's actual combined "no existe o fue
 * rechazado" message.
 */
@ExtendWith(MockitoExtension.class)
class SifenDocumentQueryClientTest {

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
  void query_parsesNotFoundOrRejectedResponse_exactlyAsObservedLive() throws Exception {
    // Verified live (2026-07-28) against sifen-test.set.gov.py: querying a syntactically valid CDC
    // that was never actually accepted by SIFEN returns this exact body, HTTP 200.
    String responseBody =
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Header/><env:Body>\
        <ns2:rEnviConsDeResponse xmlns:ns2="http://ekuatia.set.gov.py/sifen/xsd">\
        <ns2:dFecProc>2026-07-28T12:44:13-03:00</ns2:dFecProc><ns2:dCodRes>0420</ns2:dCodRes>\
        <ns2:dMsgRes>Documento No Existe en SIFEN o ha sido Rechazado</ns2:dMsgRes>\
        </ns2:rEnviConsDeResponse></env:Body></env:Envelope>""";
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    mockServer = startMockServer(material, 200, req -> responseBody);
    var client = newClient(material, mockServer.getAddress().getPort());

    Optional<SifenQueryResult> result =
        client.query(
            1L, "01011371528001001999990122026072811234567800", trustManagersFor(material));

    assertThat(result).isPresent();
    assertThat(result.get().submissionResult().status()).isEqualTo(SifenSubmissionStatus.REJECTED);
    assertThat(result.get().submissionResult().resultCode()).isEqualTo("0420");
    assertThat(result.get().submissionResult().message())
        .isEqualTo("Documento No Existe en SIFEN o ha sido Rechazado");
    assertThat(result.get().submissionResult().protocolNumber()).isNull();
    assertThat(result.get().documentContent()).isNull();
  }

  @Test
  void query_parsesFoundResponse_asApprovedWithDocumentContent() throws Exception {
    // The "CDC encontrado" shape couldn't be verified live (see class Javadoc: blocked on HU-08's
    // QR code), so this reproduces the live XSD's declared shape (dCodRes/dMsgRes/xContenDE as a
    // plain string) rather than an actually-observed response.
    String responseBody =
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body>\
        <ns2:rEnviConsDeResponse xmlns:ns2="http://ekuatia.set.gov.py/sifen/xsd">\
        <ns2:dFecProc>2026-07-28T12:00:00-03:00</ns2:dFecProc><ns2:dCodRes>0422</ns2:dCodRes>\
        <ns2:dMsgRes>CDC encontrado</ns2:dMsgRes>\
        <ns2:xContenDE>&lt;rContDe&gt;...&lt;/rContDe&gt;</ns2:xContenDE>\
        </ns2:rEnviConsDeResponse></env:Body></env:Envelope>""";
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    mockServer = startMockServer(material, 200, req -> responseBody);
    var client = newClient(material, mockServer.getAddress().getPort());

    Optional<SifenQueryResult> result =
        client.query(
            1L, "01011371528001001999990122026072811234567800", trustManagersFor(material));

    assertThat(result).isPresent();
    assertThat(result.get().submissionResult().status()).isEqualTo(SifenSubmissionStatus.APPROVED);
    assertThat(result.get().documentContent()).isEqualTo("<rContDe>...</rContDe>");
  }

  @Test
  void query_logsSifenReqAndRespLines_withOperationCdcCodeAndMessage() throws Exception {
    String cdc = "01011371528001001999990122026072811234567800";
    String responseBody =
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body>\
        <ns2:rEnviConsDeResponse xmlns:ns2="http://ekuatia.set.gov.py/sifen/xsd">\
        <ns2:dFecProc>2026-07-28T12:00:00-03:00</ns2:dFecProc><ns2:dCodRes>0422</ns2:dCodRes>\
        <ns2:dMsgRes>CDC encontrado</ns2:dMsgRes>\
        <ns2:xContenDE>&lt;rContDe&gt;...&lt;/rContDe&gt;</ns2:xContenDE>\
        </ns2:rEnviConsDeResponse></env:Body></env:Envelope>""";
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    mockServer = startMockServer(material, 200, req -> responseBody);
    var client = newClient(material, mockServer.getAddress().getPort());

    try (LogCapture logs = new LogCapture(SifenDocumentQueryClient.class)) {
      client.query(1L, cdc, trustManagersFor(material));

      assertThat(logs.messages())
          .anyMatch(
              m ->
                  m.startsWith("[SIFEN req] operation=SiConsDE")
                      && m.contains("tenantId=1")
                      && m.contains("cdc=" + cdc));
      assertThat(logs.messages())
          .anyMatch(
              m ->
                  m.startsWith("[SIFEN resp] operation=SiConsDE")
                      && m.contains("code=0422")
                      && m.contains("message=CDC encontrado"));
    }
  }

  @Test
  void query_throws_whenQueryingCertificateRucIsNotAuthorized() throws Exception {
    String responseBody =
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body>\
        <ns2:rEnviConsDeResponse xmlns:ns2="http://ekuatia.set.gov.py/sifen/xsd">\
        <ns2:dFecProc>2026-07-28T12:00:00-03:00</ns2:dFecProc><ns2:dCodRes>0421</ns2:dCodRes>\
        <ns2:dMsgRes>RUC Certificado sin permiso</ns2:dMsgRes>\
        </ns2:rEnviConsDeResponse></env:Body></env:Envelope>""";
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    mockServer = startMockServer(material, 200, req -> responseBody);
    var client = newClient(material, mockServer.getAddress().getPort());

    assertThatThrownBy(
            () ->
                client.query(
                    1L, "01011371528001001999990122026072811234567800", trustManagersFor(material)))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_QUERY_RUC_NOT_AUTHORIZED");
  }

  @Test
  void query_returnsEmpty_whenServerUnreachable() throws Exception {
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    var client = newClient(material, 1); // reserved port, nothing listens there

    Optional<SifenQueryResult> result = client.query(1L, "cdc", null);

    assertThat(result).isEmpty();
  }

  @Test
  void query_returnsEmpty_whenResponseBodyIsUnparseable() throws Exception {
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    mockServer = startMockServer(material, 200, req -> "not xml at all");
    var client = newClient(material, mockServer.getAddress().getPort());

    Optional<SifenQueryResult> result = client.query(1L, "cdc", trustManagersFor(material));

    assertThat(result).isEmpty();
  }

  @Test
  void query_returnsEmpty_forTheReceptionServicesMalformedRequestErrorShape() throws Exception {
    // Verified live (HU-06): a malformed SOAP body gets rRetEnviDe back, not rEnviConsDeResponse —
    // this consulta client must not misinterpret that shared error shape as a real answer.
    String responseBody =
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body>\
        <ns2:rRetEnviDe xmlns:ns2="http://ekuatia.set.gov.py/sifen/xsd"><ns2:rProtDe>\
        <ns2:dEstRes>Rechazado</ns2:dEstRes><ns2:gResProc><ns2:dCodRes>0160</ns2:dCodRes>\
        <ns2:dMsgRes>XML Mal Formado.</ns2:dMsgRes></ns2:gResProc></ns2:rProtDe></ns2:rRetEnviDe>\
        </env:Body></env:Envelope>""";
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    mockServer = startMockServer(material, 400, req -> responseBody);
    var client = newClient(material, mockServer.getAddress().getPort());

    Optional<SifenQueryResult> result = client.query(1L, "cdc", trustManagersFor(material));

    assertThat(result).isEmpty();
  }

  @Test
  void query_wrapsTheCdcInASoapEnvelopeWithRequiredElements() throws Exception {
    String responseBody =
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body>\
        <ns2:rEnviConsDeResponse xmlns:ns2="http://ekuatia.set.gov.py/sifen/xsd">\
        <ns2:dCodRes>0420</ns2:dCodRes><ns2:dMsgRes>x</ns2:dMsgRes>\
        </ns2:rEnviConsDeResponse></env:Body></env:Envelope>""";
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

    client.query(1L, "01011371528001001999990122026072811234567800", trustManagersFor(material));

    String sent = capturedRequest.toString();
    assertThat(sent).contains("<soap:Envelope");
    assertThat(sent).contains("<rEnviConsDeRequest xmlns=\"http://ekuatia.set.gov.py/sifen/xsd\">");
    assertThat(sent).contains("<dId>");
    assertThat(sent).contains("<dCDC>01011371528001001999990122026072811234567800</dCDC>");
  }

  private SifenDocumentQueryClient newClient(SifenActiveCertificateMaterial material, int port) {
    when(certificateService.requireActiveCertificate(1L)).thenReturn(material);
    BusinessProfile profile = new BusinessProfile();
    profile.setRuc(RUC_MATCHING_TENANT);
    when(businessProfileRepository.findByTenantId(1L)).thenReturn(Optional.of(profile));
    SifenConnectionProperties connectionProperties = new SifenConnectionProperties();
    connectionProperties.setEnvironment(Environment.TEST);
    connectionProperties.setTestBaseUrl("https://127.0.0.1:" + port);
    SifenConnectionService connectionService =
        new SifenConnectionService(
            certificateService, businessProfileRepository, connectionProperties);
    return new SifenDocumentQueryClient(connectionService, connectionProperties);
  }

  private static SifenActiveCertificateMaterial loadMaterial(String resourcePath, String password)
      throws Exception {
    byte[] bytes =
        Files.readAllBytes(
            Path.of(
                SifenDocumentQueryClientTest.class
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
        "/de/ws/consultas/consulta.wsdl",
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
