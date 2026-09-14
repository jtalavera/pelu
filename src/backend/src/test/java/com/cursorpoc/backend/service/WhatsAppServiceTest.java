package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayOutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.function.BiFunction;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/**
 * Issue #224 AC: "the HTTP client for sending template messages has unit tests with the HTTP call
 * mocked (must not depend on real credentials to pass in CI)". Stands up a local, unauthenticated,
 * plain-HTTP mock server as a stand-in for Meta's Graph API — same idea as {@link
 * SifenEventClientTest}'s local mock server for SIFEN, minus the mTLS machinery, which Meta's REST
 * API doesn't need. {@code app.femme.whatsapp.base-url} is the test seam that redirects {@link
 * WhatsAppService} at that mock server instead of the real {@code graph.facebook.com}.
 */
class WhatsAppServiceTest {

  private HttpServer mockServer;

  @AfterEach
  void tearDown() {
    if (mockServer != null) {
      mockServer.stop(0);
    }
  }

  private WhatsAppService newService(
      boolean enabled, String accessToken, String phoneNumberId, String baseUrl) {
    WhatsAppService service = new WhatsAppService(new ObjectMapper());
    ReflectionTestUtils.setField(service, "enabled", enabled);
    ReflectionTestUtils.setField(service, "accessToken", accessToken);
    ReflectionTestUtils.setField(service, "phoneNumberId", phoneNumberId);
    ReflectionTestUtils.setField(service, "apiVersion", "v21.0");
    ReflectionTestUtils.setField(service, "baseUrl", baseUrl);
    return service;
  }

  @Test
  void sendTemplateMessage_disabled_logsInsteadOfSending() {
    WhatsAppService service = newService(false, "", "", "http://127.0.0.1:1");

    assertThatCode(
            () ->
                service.sendTemplateMessage(
                    "+595981234567", "appointment_reminder", "es", List.of("Ana", "10:00")))
        .doesNotThrowAnyException();
  }

  /**
   * Same "enabled but no real credentials" safety net as {@code EmailServiceTest}'s blank
   * connection-string case: {@code app.femme.whatsapp.enabled=true} with blank access
   * token/phone-number-id (the local/dev default whenever WHATSAPP_ACCESS_TOKEN/
   * WHATSAPP_PHONE_NUMBER_ID aren't set) must fall back to the dev-log no-op, never reach the HTTP
   * call.
   */
  @Test
  void sendTemplateMessage_enabledWithBlankCredentials_fallsBackToDevLog() {
    WhatsAppService service = newService(true, "", "", "http://127.0.0.1:1");

    assertThatCode(
            () ->
                service.sendTemplateMessage(
                    "+595981234567", "appointment_reminder", "es", List.of()))
        .doesNotThrowAnyException();
  }

  @Test
  void sendTemplateMessage_success_postsExpectedGraphApiRequest() throws Exception {
    ByteArrayOutputStream capturedBody = new ByteArrayOutputStream();
    String[] capturedPath = new String[1];
    String[] capturedAuthHeader = new String[1];
    mockServer =
        startMockServer(
            (exchange, body) -> {
              capturedPath[0] = exchange.getRequestURI().toString();
              capturedAuthHeader[0] = exchange.getRequestHeaders().getFirst("Authorization");
              return new MockResponse(200, "{\"messages\":[{\"id\":\"wamid.TEST123\"}]}");
            },
            capturedBody);
    WhatsAppService service =
        newService(
            true,
            "test-access-token",
            "1234567890",
            "http://127.0.0.1:" + mockServer.getAddress().getPort());

    assertThatCode(
            () ->
                service.sendTemplateMessage(
                    "+595981234567", "appointment_reminder", "es", List.of("Ana", "10:00")))
        .doesNotThrowAnyException();

    assertThat(capturedPath[0]).isEqualTo("/v21.0/1234567890/messages");
    assertThat(capturedAuthHeader[0]).isEqualTo("Bearer test-access-token");
    String sentBody = capturedBody.toString(StandardCharsets.UTF_8);
    assertThat(sentBody).contains("\"messaging_product\":\"whatsapp\"");
    assertThat(sentBody).contains("\"to\":\"+595981234567\"");
    assertThat(sentBody).contains("\"name\":\"appointment_reminder\"");
    assertThat(sentBody).contains("\"code\":\"es\"");
    assertThat(sentBody).contains("\"text\":\"Ana\"");
    assertThat(sentBody).contains("\"text\":\"10:00\"");
  }

  @Test
  void sendTemplateMessage_noParameters_omitsComponents() throws Exception {
    ByteArrayOutputStream capturedBody = new ByteArrayOutputStream();
    mockServer = startMockServer((exchange, body) -> new MockResponse(200, "{}"), capturedBody);
    WhatsAppService service =
        newService(
            true, "token", "phone-id", "http://127.0.0.1:" + mockServer.getAddress().getPort());

    service.sendTemplateMessage("+595981234567", "no_params_template", "es", List.of());

    String sentBody = capturedBody.toString(StandardCharsets.UTF_8);
    assertThat(sentBody).doesNotContain("components");
  }

  @Test
  void sendTemplateMessage_non2xxResponse_wrapsAsWhatsAppSendFailed() throws Exception {
    mockServer =
        startMockServer(
            (exchange, body) ->
                new MockResponse(401, "{\"error\":{\"message\":\"Invalid OAuth access token\"}}"),
            new ByteArrayOutputStream());
    WhatsAppService service =
        newService(
            true,
            "bad-token",
            "1234567890",
            "http://127.0.0.1:" + mockServer.getAddress().getPort());

    assertThatThrownBy(
            () ->
                service.sendTemplateMessage(
                    "+595981234567", "appointment_reminder", "es", List.of()))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("WHATSAPP_SEND_FAILED");
  }

  @Test
  void sendTemplateMessage_serverUnreachable_wrapsAsWhatsAppSendFailed() {
    WhatsAppService service =
        newService(true, "token", "phone-id", "http://127.0.0.1:1"); // reserved port, unreachable

    assertThatThrownBy(
            () ->
                service.sendTemplateMessage(
                    "+595981234567", "appointment_reminder", "es", List.of()))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("WHATSAPP_SEND_FAILED");
  }

  private record MockResponse(int status, String body) {}

  private static HttpServer startMockServer(
      BiFunction<com.sun.net.httpserver.HttpExchange, byte[], MockResponse> responder,
      ByteArrayOutputStream capturedBodySink)
      throws Exception {
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext(
        "/",
        exchange -> {
          ByteArrayOutputStream requestBytes = new ByteArrayOutputStream();
          exchange.getRequestBody().transferTo(requestBytes);
          byte[] requestBody = requestBytes.toByteArray();
          capturedBodySink.write(requestBody);
          MockResponse response = responder.apply(exchange, requestBody);
          byte[] responseBytes = response.body().getBytes(StandardCharsets.UTF_8);
          exchange.getResponseHeaders().add("Content-Type", "application/json");
          exchange.sendResponseHeaders(response.status(), responseBytes.length);
          exchange.getResponseBody().write(responseBytes);
          exchange.close();
        });
    server.start();
    return server;
  }
}
