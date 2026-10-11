package com.cursorpoc.backend.stock;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.cursorpoc.backend.config.StockProperties;
import com.cursorpoc.backend.stock.StockApiClient.StockResponse;
import com.cursorpoc.backend.stock.StockApiClient.StockUnavailableException;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class StockApiClientTest {

  private FakeStockServer fake;
  private StockProperties properties;
  private StockApiClient client;

  @BeforeEach
  void setUp() throws Exception {
    fake = new FakeStockServer();
    properties = new StockProperties();
    properties.setEnabled(true);
    properties.setBaseUrl(fake.baseUrl());
    properties.setClientId("pelu");
    properties.setClientSecret("test-secret");
    properties.setHttpTimeout(Duration.ofSeconds(5));
    client = new StockApiClient(properties, JsonMapper.builder().build());
  }

  @AfterEach
  void tearDown() {
    fake.close();
  }

  @Test
  void sendsIntegrationHeadersAndCachesTheM2mToken() {
    client.upsertTenant(17, Map.of("name", "Salón"), "corr-1");
    StockResponse doc =
        client.postDocument(17, Map.of("type", "ISSUE"), "PELU:INVOICE:5:0", "corr-2");

    assertThat(doc.status()).isEqualTo(201);
    assertThat(fake.tokenRequests.get()).isEqualTo(1);
    FakeStockServer.Recorded call = fake.calls("/api/v1/integration/documents").get(0);
    assertThat(call.tenantHeader()).isEqualTo("17");
    assertThat(call.idempotencyKey()).isEqualTo("PELU:INVOICE:5:0");
    assertThat(call.correlationId()).isEqualTo("corr-2");
    assertThat(call.authorization()).isEqualTo("Bearer tok-1");
  }

  @Test
  void parsesTheErrorCodeOfAFailedCall() {
    StockResponse response = client.pushFlags(99, Map.of("version", 1), "c");
    assertThat(response.status()).isEqualTo(404);
    assertThat(response.errorCode()).isEqualTo("TENANT_NOT_PROVISIONED");
    assertThat(response.isSuccess()).isFalse();
  }

  @Test
  void availabilityQueriesByExternalIds() {
    client.upsertTenant(17, Map.of("name", "Salón"), "c");
    fake.availabilityBody = "{\"items\":[{\"externalId\":\"5\",\"mapped\":true,\"available\":3}]}";
    StockResponse response = client.availability(17, "SERVICE", List.of("5", "6"), "c");
    assertThat(response.isSuccess()).isTrue();
    assertThat(fake.calls("/api/v1/integration/availability").get(0).path())
        .contains("sourceSystem=PELU")
        .contains("externalType=SERVICE")
        .contains("externalIds=5%2C6");
  }

  @Test
  void invalidCredentialsSurfaceAsUnavailable() {
    properties.setClientSecret("wrong");
    assertThatThrownBy(() -> client.upsertTenant(1, Map.of(), "c"))
        .isInstanceOf(StockUnavailableException.class)
        .hasMessageContaining("STOCK_TOKEN_REQUEST_FAILED");
  }

  @Test
  void unreachableStockSurfacesAsUnavailable() {
    fake.close();
    assertThatThrownBy(() -> client.upsertTenant(1, Map.of(), "c"))
        .isInstanceOf(StockUnavailableException.class);
  }
}
