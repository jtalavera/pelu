package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.config.SifenConnectionProperties;
import com.cursorpoc.backend.config.SifenConnectionProperties.Environment;
import com.cursorpoc.backend.service.SifenServiceConnectivityChecker.Outcome;
import com.cursorpoc.backend.testsupport.LogCapture;
import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsServer;
import java.io.ByteArrayInputStream;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

/**
 * HU-12: proves the classification logic (accepted vs. rejected, per {@link
 * SifenServiceConnectivityChecker#check}) for every one of the 7 named services in {@link
 * SifenHomologationEndpoint}, against a local {@link HttpsServer} standing in for SIFEN — same
 * pattern as {@code SifenConnectionServiceTest}, reproducing the real 200-vs-302-hangup behavior
 * verified live rather than depending on external network access. This always runs in CI; the
 * separate, guarded {@code SifenHomologationConnectivityLiveTest} is what actually exercises the
 * real {@code sifen-test.set.gov.py} when the gitignored pilot certificate is present locally.
 */
class SifenServiceConnectivityCheckerTest {

  private HttpsServer mockServer;

  @AfterEach
  void tearDown() {
    if (mockServer != null) {
      mockServer.stop(0);
    }
  }

  @ParameterizedTest
  @EnumSource(SifenHomologationEndpoint.class)
  void check_classifiesAsAccepted_whenServerRespondsOk(SifenHomologationEndpoint endpoint)
      throws Exception {
    Fixture fixture = loadFixture("sifen/ruc-fixture.p12", "TestPass123!");
    mockServer = startMockServer(endpoint.wsdlPath(), 200, null, fixture);

    var checker = newChecker(mockServer.getAddress().getPort());
    var result =
        checker.check(
            endpoint,
            fixture.keyStore(),
            fixture.password(),
            Outcome.ACCEPTED,
            trustManagersFor(fixture.certificate()));

    assertThat(result.actual()).isEqualTo(Outcome.ACCEPTED);
    assertThat(result.httpStatus()).isEqualTo(200);
    assertThat(result.matchesExpectation()).isTrue();
  }

  @Test
  void check_logsSifenReqAndRespLines_withOperationAndHttpStatus() throws Exception {
    SifenHomologationEndpoint endpoint = SifenHomologationEndpoint.IMMEDIATE_RECEPTION;
    Fixture fixture = loadFixture("sifen/ruc-fixture.p12", "TestPass123!");
    mockServer = startMockServer(endpoint.wsdlPath(), 200, null, fixture);

    var checker = newChecker(mockServer.getAddress().getPort());

    try (LogCapture logs = new LogCapture(SifenServiceConnectivityChecker.class)) {
      checker.check(
          endpoint,
          fixture.keyStore(),
          fixture.password(),
          Outcome.ACCEPTED,
          trustManagersFor(fixture.certificate()));

      assertThat(logs.messages())
          .anyMatch(m -> m.startsWith("[SIFEN req] operation=" + endpoint.displayName()));
      assertThat(logs.messages())
          .anyMatch(
              m ->
                  m.startsWith("[SIFEN resp] operation=" + endpoint.displayName())
                      && m.contains("httpStatus=200"));
    }
  }

  @ParameterizedTest
  @EnumSource(SifenHomologationEndpoint.class)
  void check_classifiesAsRejected_whenServerRedirectsLikeRealSifenHangup(
      SifenHomologationEndpoint endpoint) throws Exception {
    // The real sifen-test.set.gov.py does exactly this (HTTP 302, Location containing
    // /vdesk/hangup.php3) for every one of these 7 services when the client certificate isn't
    // trusted — verified live for all 7 (see PROGRESS.md's HU-12 section).
    Fixture fixture = loadFixture("sifen/ruc-fixture.p12", "TestPass123!");
    mockServer = startMockServer(endpoint.wsdlPath(), 302, "/vdesk/hangup.php3", fixture);

    var checker = newChecker(mockServer.getAddress().getPort());
    var result =
        checker.check(
            endpoint,
            fixture.keyStore(),
            fixture.password(),
            Outcome.REJECTED,
            trustManagersFor(fixture.certificate()));

    assertThat(result.actual()).isEqualTo(Outcome.REJECTED);
    assertThat(result.httpStatus()).isEqualTo(302);
    assertThat(result.matchesExpectation()).isTrue();
  }

  @ParameterizedTest
  @EnumSource(SifenHomologationEndpoint.class)
  void check_classifiesAsRejected_whenServerUnreachable(SifenHomologationEndpoint endpoint)
      throws Exception {
    Fixture fixture = loadFixture("sifen/ruc-fixture.p12", "TestPass123!");
    // Port 1 on loopback: reserved, nothing ever listens there.
    var checker = newChecker(1);
    var result =
        checker.check(
            endpoint,
            fixture.keyStore(),
            fixture.password(),
            Outcome.REJECTED,
            trustManagersFor(fixture.certificate()));

    assertThat(result.actual()).isEqualTo(Outcome.REJECTED);
    assertThat(result.httpStatus()).isEqualTo(-1);
    assertThat(result.matchesExpectation()).isTrue();
  }

  private SifenServiceConnectivityChecker newChecker(int port) {
    SifenConnectionProperties properties = new SifenConnectionProperties();
    properties.setEnvironment(Environment.TEST);
    properties.setTestBaseUrl("https://127.0.0.1:" + port);
    return new SifenServiceConnectivityChecker(properties);
  }

  private record Fixture(KeyStore keyStore, String password, X509Certificate certificate) {}

  private static Fixture loadFixture(String resourcePath, String password) throws Exception {
    byte[] bytes =
        Files.readAllBytes(
            Path.of(
                SifenServiceConnectivityCheckerTest.class
                    .getClassLoader()
                    .getResource(resourcePath)
                    .getPath()));
    KeyStore keyStore = KeyStore.getInstance("PKCS12");
    keyStore.load(new ByteArrayInputStream(bytes), password.toCharArray());
    String alias = keyStore.aliases().nextElement();
    X509Certificate certificate = (X509Certificate) keyStore.getCertificate(alias);
    return new Fixture(keyStore, password, certificate);
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
   * A local HTTPS server standing in for SIFEN, presenting {@code fixture}'s certificate as its own
   * server identity (self-signed, reused for simplicity — same rationale as
   * SifenConnectionServiceTest). Registers a context at {@code wsdlPath} minus its query string,
   * since {@link com.sun.net.httpserver.HttpExchange#getRequestURI()} never includes one either.
   */
  private static HttpsServer startMockServer(
      String wsdlPath, int responseStatus, String redirectLocation, Fixture fixture)
      throws Exception {
    KeyManagerFactory keyManagerFactory =
        KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
    keyManagerFactory.init(fixture.keyStore(), fixture.password().toCharArray());
    SSLContext serverContext = SSLContext.getInstance("TLSv1.2");
    serverContext.init(keyManagerFactory.getKeyManagers(), null, new SecureRandom());

    HttpsServer server = HttpsServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.setHttpsConfigurator(new HttpsConfigurator(serverContext));
    String path = wsdlPath.split("\\?")[0];
    server.createContext(
        path,
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
