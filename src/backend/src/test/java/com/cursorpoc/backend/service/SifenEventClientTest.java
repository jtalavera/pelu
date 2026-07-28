package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.config.SifenConnectionProperties;
import com.cursorpoc.backend.config.SifenConnectionProperties.Environment;
import com.cursorpoc.backend.domain.BusinessProfile;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
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
 * Exercises {@link SifenEventClient} against a local mock HTTPS server standing in for SIFEN's
 * event registration service ({@code siRecepEvento}) — response shapes per the real, live {@code
 * evento.wsdl.xsd1.xsd} fetched (2026-07-28) for this story: {@code rRetEnviEventoDe/
 * dFecProc/gResProcEVe(dEstRes,dProtAut?,id,gResProc*(dCodRes,dMsgRes))}.
 */
@ExtendWith(MockitoExtension.class)
class SifenEventClientTest {

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
  void send_parsesApprovedCancellation_withProtocolNumber() throws Exception {
    String responseBody =
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body>\
        <ns2:rRetEnviEventoDe xmlns:ns2="http://ekuatia.set.gov.py/sifen/xsd">\
        <ns2:dFecProc>2026-07-28T12:15:07-03:00</ns2:dFecProc>\
        <ns2:gResProcEVe><ns2:dEstRes>Aprobado</ns2:dEstRes>\
        <ns2:dProtAut>987654321</ns2:dProtAut><ns2:id>123</ns2:id>\
        <ns2:gResProc><ns2:dCodRes>0600</ns2:dCodRes>\
        <ns2:dMsgRes>Evento registrado correctamente</ns2:dMsgRes></ns2:gResProc>\
        </ns2:gResProcEVe></ns2:rRetEnviEventoDe></env:Body></env:Envelope>""";
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    mockServer = startMockServer(material, 200, req -> responseBody);
    var client = newClient(material, mockServer.getAddress().getPort());

    Optional<SifenSubmissionResult> result =
        client.send(1L, "<rGesEve/>", trustManagersFor(material));

    assertThat(result).isPresent();
    assertThat(result.get().status()).isEqualTo(SifenSubmissionStatus.APPROVED);
    assertThat(result.get().protocolNumber()).isEqualTo("987654321");
    assertThat(result.get().resultCode()).isEqualTo("0600");
    assertThat(result.get().message()).isEqualTo("Evento registrado correctamente");
  }

  @Test
  void send_parsesRejectedCancellation_pastDeadline() throws Exception {
    // Sección 11.6.1 GDE004a: código 4009, "Plazo de solicitud de cancelación... extemporáneo".
    String responseBody =
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body>\
        <ns2:rRetEnviEventoDe xmlns:ns2="http://ekuatia.set.gov.py/sifen/xsd">\
        <ns2:dFecProc>2026-07-28T12:15:07-03:00</ns2:dFecProc>\
        <ns2:gResProcEVe><ns2:dEstRes>Rechazado</ns2:dEstRes><ns2:id>123</ns2:id>\
        <ns2:gResProc><ns2:dCodRes>4009</ns2:dCodRes>\
        <ns2:dMsgRes>Plazo de solicitud de cancelación de una FE extemporáneo</ns2:dMsgRes>\
        </ns2:gResProc></ns2:gResProcEVe></ns2:rRetEnviEventoDe></env:Body></env:Envelope>""";
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    mockServer = startMockServer(material, 200, req -> responseBody);
    var client = newClient(material, mockServer.getAddress().getPort());

    Optional<SifenSubmissionResult> result =
        client.send(1L, "<rGesEve/>", trustManagersFor(material));

    assertThat(result).isPresent();
    assertThat(result.get().status()).isEqualTo(SifenSubmissionStatus.REJECTED);
    assertThat(result.get().resultCode()).isEqualTo("4009");
    assertThat(result.get().protocolNumber()).isNull();
  }

  @Test
  void send_returnsEmpty_whenServerUnreachable() throws Exception {
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    var client = newClient(material, 1); // reserved port, nothing listens there

    Optional<SifenSubmissionResult> result = client.send(1L, "<rGesEve/>", null);

    assertThat(result).isEmpty();
  }

  @Test
  void send_returnsEmpty_whenResponseBodyIsUnparseable() throws Exception {
    SifenActiveCertificateMaterial material = loadMaterial("sifen/ruc-fixture.p12", "TestPass123!");
    mockServer = startMockServer(material, 200, req -> "not xml at all");
    var client = newClient(material, mockServer.getAddress().getPort());

    Optional<SifenSubmissionResult> result =
        client.send(1L, "<rGesEve/>", trustManagersFor(material));

    assertThat(result).isEmpty();
  }

  @Test
  void send_wrapsTheSignedEventInASoapEnvelopeWithRequiredElements() throws Exception {
    String responseBody =
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body>\
        <ns2:rRetEnviEventoDe xmlns:ns2="http://ekuatia.set.gov.py/sifen/xsd">\
        <ns2:dFecProc>2026-07-28T12:15:07-03:00</ns2:dFecProc>\
        <ns2:gResProcEVe><ns2:dEstRes>Rechazado</ns2:dEstRes><ns2:id>1</ns2:id>\
        <ns2:gResProc><ns2:dCodRes>4002</ns2:dCodRes><ns2:dMsgRes>x</ns2:dMsgRes></ns2:gResProc>\
        </ns2:gResProcEVe></ns2:rRetEnviEventoDe></env:Body></env:Envelope>""";
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

    client.send(1L, "<rGesEve><rEve Id=\"1\"/></rGesEve>", trustManagersFor(material));

    String sent = capturedRequest.toString();
    assertThat(sent).contains("<soap:Envelope");
    assertThat(sent).contains("<rEnviEventoDe xmlns=\"http://ekuatia.set.gov.py/sifen/xsd\">");
    assertThat(sent).contains("<dId>");
    assertThat(sent)
        .contains("<dEvReg><gGroupGesEve><rGesEve><rEve Id=\"1\"/></rGesEve></gGroupGesEve>");
  }

  private SifenEventClient newClient(SifenActiveCertificateMaterial material, int port) {
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
    return new SifenEventClient(connectionService, connectionProperties, new FemmeTimeProperties());
  }

  private static SifenActiveCertificateMaterial loadMaterial(String resourcePath, String password)
      throws Exception {
    byte[] bytes =
        Files.readAllBytes(
            Path.of(
                SifenEventClientTest.class.getClassLoader().getResource(resourcePath).getPath()));
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
        "/de/ws/eventos/evento.wsdl",
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
