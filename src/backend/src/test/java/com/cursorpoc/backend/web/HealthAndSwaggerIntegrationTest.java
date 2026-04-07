package com.cursorpoc.backend.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class HealthAndSwaggerIntegrationTest {

  @LocalServerPort private int port;

  @Test
  void health_returnsUp() throws Exception {
    HttpClient client = HttpClient.newHttpClient();
    HttpRequest req =
        HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/health")).GET().build();
    HttpResponse<String> res = client.send(req, HttpResponse.BodyHandlers.ofString());
    assertThat(res.statusCode()).isEqualTo(200);
    assertThat(res.body()).contains("\"status\":\"UP\"");
  }

  @Test
  void swaggerUi_defaultUrl_isReachable() throws Exception {
    HttpClient client = HttpClient.newHttpClient();
    HttpRequest req =
        HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/swagger-ui.html"))
            .GET()
            .build();
    HttpResponse<Void> res = client.send(req, HttpResponse.BodyHandlers.discarding());
    assertThat(res.statusCode()).isBetween(200, 399);
  }
}
