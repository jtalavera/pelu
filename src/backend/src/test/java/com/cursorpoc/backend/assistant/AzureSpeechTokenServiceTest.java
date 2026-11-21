package com.cursorpoc.backend.assistant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.cursorpoc.backend.assistant.SpeechTokenProvider.SpeechToken;
import com.cursorpoc.backend.assistant.SpeechTokenProvider.SpeechUnavailableException;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The exchange of the backend's Entra identity for a Speech-only token, against a local server. */
class AzureSpeechTokenServiceTest {

  private HttpServer server;
  private String endpoint;
  private final AtomicReference<String> method = new AtomicReference<>();
  private final AtomicReference<String> path = new AtomicReference<>();
  private final AtomicReference<String> authorization = new AtomicReference<>();
  private volatile int status = 200;
  private volatile String body = "speech.jwt.token\n";

  @BeforeEach
  void startServer() throws Exception {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext(
        "/",
        exchange -> {
          method.set(exchange.getRequestMethod());
          path.set(exchange.getRequestURI().getPath());
          authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
          byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
          exchange.sendResponseHeaders(status, bytes.length);
          exchange.getResponseBody().write(bytes);
          exchange.close();
        });
    server.start();
    endpoint = "http://127.0.0.1:" + server.getAddress().getPort() + "/";
  }

  @AfterEach
  void stopServer() {
    server.stop(0);
  }

  private AzureSpeechTokenService service(String region) {
    return new AzureSpeechTokenService(
        endpoint, region, () -> "entra-token", HttpClient.newHttpClient());
  }

  @Test
  void exchangesTheEntraTokenForASpeechToken_andNeverReturnsTheEntraOne() {
    SpeechToken token = service("centralus").issue();

    assertThat(method.get()).isEqualTo("POST");
    assertThat(path.get()).isEqualTo("/sts/v1.0/issueToken");
    assertThat(authorization.get()).isEqualTo("Bearer entra-token");
    assertThat(token.token()).isEqualTo("speech.jwt.token"); // trimmed
    assertThat(token.token()).doesNotContain("entra-token");
    assertThat(token.region()).isEqualTo("centralus");
    // Azure issues 10 minutes; the browser is told 9 so it renews before it expires.
    assertThat(token.expiresInSeconds()).isEqualTo(540);
  }

  @Test
  void anEndpointWithoutATrailingSlash_works() {
    endpoint = endpoint.substring(0, endpoint.length() - 1);

    assertThat(service("centralus").issue().token()).isEqualTo("speech.jwt.token");
    assertThat(path.get()).isEqualTo("/sts/v1.0/issueToken");
  }

  @Test
  void azureRefusing_isUnavailable_andTheBodyIsNotLeaked() {
    status = 401;
    body = "SECRET-DETAIL-FROM-AZURE";

    assertThatThrownBy(() -> service("centralus").issue())
        .isInstanceOf(SpeechUnavailableException.class)
        .hasMessage("issueToken answered 401")
        .hasMessageNotContaining("SECRET");
  }

  @Test
  void anEmptyAnswer_isUnavailable() {
    body = "  ";

    assertThatThrownBy(() -> service("centralus").issue())
        .isInstanceOf(SpeechUnavailableException.class);
  }

  @Test
  void notConfigured_isUnavailable_withoutCallingAzure() {
    assertThatThrownBy(() -> service("").issue()).isInstanceOf(SpeechUnavailableException.class);
    assertThatThrownBy(
            () ->
                new AzureSpeechTokenService("", "centralus", () -> "x", HttpClient.newHttpClient())
                    .issue())
        .isInstanceOf(SpeechUnavailableException.class);
    assertThat(method.get()).isNull();
  }

  @Test
  void aCredentialFailure_isUnavailable() {
    AzureSpeechTokenService noLogin =
        new AzureSpeechTokenService(
            endpoint,
            "centralus",
            () -> {
              throw new IllegalStateException("not logged in: details");
            },
            HttpClient.newHttpClient());

    assertThatThrownBy(noLogin::issue)
        .isInstanceOf(SpeechUnavailableException.class)
        .hasMessageNotContaining("details");
  }

  @Test
  void anUnreachableServer_isUnavailable() {
    server.stop(0);

    assertThatThrownBy(() -> service("centralus").issue())
        .isInstanceOf(SpeechUnavailableException.class);
  }
}
