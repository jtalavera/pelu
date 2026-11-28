package com.cursorpoc.backend.whatsapp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayOutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Function;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * HU-WAP-01: the Meta gateway against a local mock server (no credentials, no network). Covers the
 * request bodies with URL and quick-reply buttons, reading the {@code wamid}, and every error
 * category. The JSON shapes follow Meta's API as known for v21.0 and still have to be contrasted
 * with the current documentation (see {@link MetaCloudWhatsAppGateway}).
 */
class MetaCloudWhatsAppGatewayTest {

  private static final ObjectMapper MAPPER = new ObjectMapper();

  /** One request as the mock server received it. */
  private record Received(String method, String path, String authorization, String body) {}

  private HttpServer server;
  private final List<Received> received = new CopyOnWriteArrayList<>();

  @AfterEach
  void tearDown() {
    if (server != null) {
      server.stop(0);
    }
  }

  private String start(Function<Received, String[]> responder) throws Exception {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext(
        "/",
        exchange -> {
          ByteArrayOutputStream buf = new ByteArrayOutputStream();
          exchange.getRequestBody().transferTo(buf);
          Received r =
              new Received(
                  exchange.getRequestMethod(),
                  exchange.getRequestURI().toString(),
                  exchange.getRequestHeaders().getFirst("Authorization"),
                  buf.toString(StandardCharsets.UTF_8));
          received.add(r);
          String[] resp = responder.apply(r); // [status, body]
          byte[] out = resp[1].getBytes(StandardCharsets.UTF_8);
          exchange.getResponseHeaders().add("Content-Type", "application/json");
          exchange.sendResponseHeaders(Integer.parseInt(resp[0]), out.length);
          exchange.getResponseBody().write(out);
          exchange.close();
        });
    server.start();
    return "http://127.0.0.1:" + server.getAddress().getPort();
  }

  private static MetaCloudWhatsAppGateway gateway(String baseUrl, boolean enabled, String token) {
    WhatsAppSettings settings =
        new WhatsAppSettings(
            enabled,
            "meta",
            token,
            "PHONE123",
            "WABA456",
            "app-secret",
            "verify",
            "v21.0",
            baseUrl,
            1000,
            2000,
            1000);
    return new MetaCloudWhatsAppGateway(settings, MAPPER);
  }

  private static WhatsAppOutboundMessage reminder() {
    return WhatsAppTemplate.RECORDATORIO_TURNO.message(
        "+595981123456",
        List.of("María", "Salón Bella", "Corte", "viernes 28/11", "15:30"),
        List.of(
            WhatsAppButton.quickReply(0, "p-confirm"),
            WhatsAppButton.quickReply(1, "p-cancel"),
            WhatsAppButton.url(2, "bella/turno/abc123")));
  }

  @Test
  void send_buildsTemplateBodyWithUrlAndQuickReplyButtons_andReturnsTheWamid() throws Exception {
    String base =
        start(
            r ->
                new String[] {
                  "200",
                  "{\"messaging_product\":\"whatsapp\",\"contacts\":[{\"wa_id\":\"595981123456\"}],"
                      + "\"messages\":[{\"id\":\"wamid.HBgL123\"}]}"
                });

    WhatsAppSendResult result =
        gateway(base, true, "tok-123").send(reminder(), Duration.ofSeconds(2));

    assertThat(result.wamid()).isEqualTo("wamid.HBgL123");
    assertThat(received).hasSize(1);
    Received r = received.get(0);
    assertThat(r.method()).isEqualTo("POST");
    assertThat(r.path()).isEqualTo("/v21.0/PHONE123/messages");
    assertThat(r.authorization()).isEqualTo("Bearer tok-123");

    JsonNode body = MAPPER.readTree(r.body());
    assertThat(body.path("messaging_product").asString()).isEqualTo("whatsapp");
    assertThat(body.path("to").asString()).isEqualTo("+595981123456");
    assertThat(body.path("type").asString()).isEqualTo("template");
    JsonNode template = body.path("template");
    assertThat(template.path("name").asString()).isEqualTo("pelu_recordatorio_turno");
    assertThat(template.path("language").path("code").asString()).isEqualTo("es");

    JsonNode components = template.path("components");
    assertThat(components).hasSize(4);
    assertThat(components.get(0).path("type").asString()).isEqualTo("body");
    List<String> bodyTexts = new ArrayList<>();
    components.get(0).path("parameters").forEach(p -> bodyTexts.add(p.path("text").asString()));
    assertThat(bodyTexts)
        .containsExactly("María", "Salón Bella", "Corte", "viernes 28/11", "15:30");

    JsonNode quick0 = components.get(1);
    assertThat(quick0.path("type").asString()).isEqualTo("button");
    assertThat(quick0.path("sub_type").asString()).isEqualTo("quick_reply");
    assertThat(quick0.path("index").asString()).isEqualTo("0");
    assertThat(quick0.path("parameters").get(0).path("type").asString()).isEqualTo("payload");
    assertThat(quick0.path("parameters").get(0).path("payload").asString()).isEqualTo("p-confirm");
    assertThat(components.get(2).path("parameters").get(0).path("payload").asString())
        .isEqualTo("p-cancel");

    JsonNode url = components.get(3);
    assertThat(url.path("sub_type").asString()).isEqualTo("url");
    assertThat(url.path("index").asString()).isEqualTo("2");
    assertThat(url.path("parameters").get(0).path("type").asString()).isEqualTo("text");
    assertThat(url.path("parameters").get(0).path("text").asString())
        .isEqualTo("bella/turno/abc123");
  }

  @Test
  void send_authenticationTemplate_carriesTheCodeInBodyAndInTheCopyButton() throws Exception {
    String base = start(r -> new String[] {"200", "{\"messages\":[{\"id\":\"wamid.OTP\"}]}"});
    WhatsAppOutboundMessage otp =
        WhatsAppTemplate.CODIGO_VERIFICACION.message(
            "+595981123456", List.of("482915"), List.of(WhatsAppButton.url(0, "482915")));

    gateway(base, true, "tok").send(otp, Duration.ofSeconds(2));

    JsonNode components =
        MAPPER.readTree(received.get(0).body()).path("template").path("components");
    assertThat(components.get(0).path("parameters").get(0).path("text").asString())
        .isEqualTo("482915");
    assertThat(components.get(1).path("sub_type").asString()).isEqualTo("url");
    assertThat(components.get(1).path("parameters").get(0).path("text").asString())
        .isEqualTo("482915");
  }

  @Test
  void send_successWithoutAMessageId_isTreatedAsTransientFailure() throws Exception {
    String base = start(r -> new String[] {"200", "{\"messages\":[]}"});

    assertThatThrownBy(() -> gateway(base, true, "tok").send(reminder(), Duration.ofSeconds(2)))
        .isInstanceOfSatisfying(
            WhatsAppSendException.class,
            e -> assertThat(e.getCode()).isEqualTo(WhatsAppErrorCode.TRANSIENT));
  }

  @ParameterizedTest
  @CsvSource({
    "401,190,AUTH_FAILED,false",
    "403,10,AUTH_FAILED,false",
    "400,200,AUTH_FAILED,false",
    "400,299,AUTH_FAILED,false",
    "400,131026,INVALID_RECIPIENT,false",
    "400,131030,INVALID_RECIPIENT,false",
    "404,132001,TEMPLATE_UNAVAILABLE,false",
    "400,132015,TEMPLATE_UNAVAILABLE,false",
    "400,132016,TEMPLATE_UNAVAILABLE,false",
    "400,132000,INVALID_REQUEST,false",
    "400,132012,INVALID_REQUEST,false",
    "429,130429,RATE_LIMITED,true",
    "400,131048,RATE_LIMITED,true",
    "400,131056,RATE_LIMITED,true",
    "500,131000,TRANSIENT,true",
    "503,131016,TRANSIENT,true",
    "429,0,RATE_LIMITED,true",
    "502,0,TRANSIENT,true",
    "401,0,AUTH_FAILED,false",
    "400,0,INVALID_REQUEST,false"
  })
  void send_classifiesMetaErrors(int http, int metaCode, WhatsAppErrorCode expected, boolean retry)
      throws Exception {
    String errorBody =
        metaCode == 0
            ? "{}"
            : "{\"error\":{\"message\":\"free text that must never be logged\",\"code\":"
                + metaCode
                + ",\"fbtrace_id\":\"x\"}}";
    String base = start(r -> new String[] {String.valueOf(http), errorBody});

    assertThatThrownBy(() -> gateway(base, true, "tok").send(reminder(), Duration.ofSeconds(2)))
        .isInstanceOfSatisfying(
            WhatsAppSendException.class,
            e -> {
              assertThat(e.getCode()).isEqualTo(expected);
              assertThat(e.isRetryable()).isEqualTo(retry);
              assertThat(e.getMessage()).doesNotContain("free text");
            });
  }

  @Test
  void send_nonJsonErrorPage_isClassifiedByHttpStatus() throws Exception {
    String base = start(r -> new String[] {"502", "<html>Bad gateway</html>"});

    assertThatThrownBy(() -> gateway(base, true, "tok").send(reminder(), Duration.ofSeconds(2)))
        .isInstanceOfSatisfying(
            WhatsAppSendException.class,
            e -> assertThat(e.getCode()).isEqualTo(WhatsAppErrorCode.TRANSIENT));
  }

  @Test
  void send_connectionRefused_isTransient() {
    assertThatThrownBy(
            () ->
                gateway("http://127.0.0.1:1", true, "tok").send(reminder(), Duration.ofSeconds(2)))
        .isInstanceOfSatisfying(
            WhatsAppSendException.class,
            e -> assertThat(e.getCode()).isEqualTo(WhatsAppErrorCode.TRANSIENT));
  }

  @Test
  void send_responseSlowerThanTheTimeout_isTransient() throws Exception {
    String base =
        start(
            r -> {
              try {
                Thread.sleep(1500);
              } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
              }
              return new String[] {"200", "{\"messages\":[{\"id\":\"late\"}]}"};
            });

    assertThatThrownBy(() -> gateway(base, true, "tok").send(reminder(), Duration.ofMillis(300)))
        .isInstanceOfSatisfying(
            WhatsAppSendException.class,
            e -> assertThat(e.getCode()).isEqualTo(WhatsAppErrorCode.TRANSIENT));
  }

  @Test
  void send_disabledOrWithoutCredentials_neverCallsOut() throws Exception {
    String base = start(r -> new String[] {"200", "{}"});

    assertThatThrownBy(() -> gateway(base, false, "tok").send(reminder(), Duration.ofSeconds(1)))
        .isInstanceOfSatisfying(
            WhatsAppSendException.class,
            e -> assertThat(e.getCode()).isEqualTo(WhatsAppErrorCode.CHANNEL_UNAVAILABLE));
    assertThatThrownBy(() -> gateway(base, true, "").send(reminder(), Duration.ofSeconds(1)))
        .isInstanceOfSatisfying(
            WhatsAppSendException.class,
            e -> assertThat(e.getCode()).isEqualTo(WhatsAppErrorCode.CHANNEL_UNAVAILABLE));
    assertThat(received).isEmpty();
  }

  @Test
  void listTemplates_readsStatusesAndFollowsPaging() throws Exception {
    String[] base = new String[1];
    base[0] =
        start(
            r -> {
              if (r.path().contains("page=2")) {
                return new String[] {
                  "200",
                  "{\"data\":[{\"name\":\"pelu_turno_cancelado\",\"language\":\"es\","
                      + "\"status\":\"PAUSED\",\"category\":\"UTILITY\"}]}"
                };
              }
              return new String[] {
                "200",
                "{\"data\":[{\"name\":\"pelu_turno_confirmado\",\"language\":\"es\","
                    + "\"status\":\"APPROVED\",\"category\":\"UTILITY\",\"rejected_reason\":\"NONE\"},"
                    + "{\"name\":\"pelu_turno_pendiente\",\"language\":\"es\",\"status\":\"REJECTED\","
                    + "\"category\":\"UTILITY\",\"rejected_reason\":\"INCORRECT_CATEGORY\"}],"
                    + "\"paging\":{\"next\":\""
                    + base[0]
                    + "/v21.0/WABA456/message_templates?page=2\"}}"
              };
            });

    List<WhatsAppRemoteTemplate> templates = gateway(base[0], true, "tok").listTemplates();

    assertThat(templates)
        .extracting(WhatsAppRemoteTemplate::name, WhatsAppRemoteTemplate::status)
        .containsExactly(
            org.assertj.core.groups.Tuple.tuple("pelu_turno_confirmado", "APPROVED"),
            org.assertj.core.groups.Tuple.tuple("pelu_turno_pendiente", "REJECTED"),
            org.assertj.core.groups.Tuple.tuple("pelu_turno_cancelado", "PAUSED"));
    assertThat(templates.get(0).reason()).isNull();
    assertThat(templates.get(1).reason()).isEqualTo("INCORRECT_CATEGORY");
    assertThat(received.get(0).path()).startsWith("/v21.0/WABA456/message_templates");
    assertThat(received.get(0).authorization()).isEqualTo("Bearer tok");
  }

  @Test
  void sessionBody_text_and_replyButtons() {
    var text =
        MetaCloudWhatsAppGateway.buildSessionBody(
            WhatsAppSessionMessage.text("+595981000000", "Hola"));
    assertThat(text).containsEntry("type", "text").containsEntry("to", "+595981000000");
    assertThat(text.get("text")).isEqualTo(java.util.Map.of("body", "Hola"));

    var buttons =
        MetaCloudWhatsAppGateway.buildSessionBody(
            new WhatsAppSessionMessage(
                "+595981000000",
                "¿Cancelar?",
                java.util.List.of(
                    new WhatsAppSessionMessage.ReplyButton("a", "Sí, cancelar"),
                    new WhatsAppSessionMessage.ReplyButton("b", "No, mantener"))));
    assertThat(buttons).containsEntry("type", "interactive");
    String json = buttons.toString();
    assertThat(json).contains("button").contains("reply").contains("Sí, cancelar").contains("id=a");
  }
}
