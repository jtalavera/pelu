package com.cursorpoc.backend.stock;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.domain.FeatureFlag;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.Tier;
import com.cursorpoc.backend.domain.enums.TenantStatus;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.FeatureFlagRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.repository.TierRepository;
import com.cursorpoc.backend.security.JwtService;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.ActiveProfiles;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Stock integration (HU-61): the inbound M2M surface — {@code POST /api/integration/oauth/token}
 * (client_credentials, scope {@code flags:read}) and {@code GET
 * /api/integration/feature-flags/resolved}, exactly as control-stock's {@code
 * PeluFeatureFlagReconciler} calls them.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class IntegrationEndpointsIntegrationTest {

  private static final String CLIENT_SECRET = "test-integration-client-secret";

  @LocalServerPort int port;
  @Autowired TenantRepository tenants;
  @Autowired TierRepository tiers;
  @Autowired FeatureFlagRepository flags;
  @Autowired JwtService jwtService;
  @Autowired ObjectMapper objectMapper;

  private final HttpClient http = HttpClient.newHttpClient();
  private Tenant tenant;

  @BeforeEach
  void setUp() {
    for (String key : new String[] {"STOCK_MODULE", "STOCK_TOURS", "GUIDED_TOUR"}) {
      FeatureFlag f = flags.findByFlagKey(key).orElseGet(FeatureFlag::new);
      f.setFlagKey(key);
      f.setEnabled(true);
      flags.save(f);
    }
    Tier tier = new Tier();
    tier.setName("T " + UUID.randomUUID());
    tiers.save(tier);
    tenant = new Tenant();
    tenant.setName("Salón " + UUID.randomUUID());
    tenant.setTier(tier);
    tenant.setStatus(TenantStatus.ACTIVE);
    tenants.save(tenant);
  }

  private HttpResponse<String> token(String form) throws Exception {
    return http.send(
        HttpRequest.newBuilder(url("/api/integration/oauth/token"))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .POST(HttpRequest.BodyPublishers.ofString(form))
            .build(),
        HttpResponse.BodyHandlers.ofString());
  }

  private HttpResponse<String> get(String path, String bearer) throws Exception {
    HttpRequest.Builder b = HttpRequest.newBuilder(url(path)).GET();
    if (bearer != null) {
      b.header("Authorization", "Bearer " + bearer);
    }
    return http.send(b.build(), HttpResponse.BodyHandlers.ofString());
  }

  private URI url(String path) {
    return URI.create("http://127.0.0.1:" + port + path);
  }

  private String validToken() throws Exception {
    HttpResponse<String> res =
        token(
            "grant_type=client_credentials&client_id=control-stock&client_secret="
                + CLIENT_SECRET
                + "&scope=flags:read");
    assertThat(res.statusCode()).isEqualTo(200);
    return objectMapper.readTree(res.body()).path("access_token").asString();
  }

  @Test
  void clientCredentialsIssueAOneHourFlagsReadToken() throws Exception {
    HttpResponse<String> res =
        token(
            "grant_type=client_credentials&client_id=control-stock&client_secret="
                + CLIENT_SECRET
                + "&scope=flags:read");
    JsonNode body = objectMapper.readTree(res.body());
    assertThat(res.statusCode()).isEqualTo(200);
    assertThat(body.path("token_type").asString()).isEqualTo("Bearer");
    assertThat(body.path("expires_in").asLong()).isEqualTo(3600);
    assertThat(body.path("scope").asString()).isEqualTo("flags:read");
  }

  @Test
  void httpBasicCredentialsAreAcceptedToo() throws Exception {
    String basic =
        Base64.getEncoder()
            .encodeToString(("control-stock:" + CLIENT_SECRET).getBytes(StandardCharsets.UTF_8));
    HttpResponse<String> res =
        http.send(
            HttpRequest.newBuilder(url("/api/integration/oauth/token"))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .header("Authorization", "Basic " + basic)
                .POST(HttpRequest.BodyPublishers.ofString("grant_type=client_credentials"))
                .build(),
            HttpResponse.BodyHandlers.ofString());
    assertThat(res.statusCode()).isEqualTo(200);
  }

  @Test
  void wrongSecretIsInvalidClient() throws Exception {
    HttpResponse<String> res =
        token("grant_type=client_credentials&client_id=control-stock&client_secret=nope");
    assertThat(res.statusCode()).isEqualTo(401);
    assertThat(res.body()).contains("INVALID_CLIENT");
  }

  @Test
  void anyOtherScopeIsInvalidScope() throws Exception {
    HttpResponse<String> res =
        token(
            "grant_type=client_credentials&client_id=control-stock&client_secret="
                + CLIENT_SECRET
                + "&scope=stock:admin");
    assertThat(res.statusCode()).isEqualTo(400);
    assertThat(res.body()).contains("INVALID_SCOPE");
  }

  @Test
  void resolvedFlagsReturnsOnlyStockFlagsWithTheirVersion() throws Exception {
    HttpResponse<String> res =
        get(
            "/api/integration/feature-flags/resolved?prefix=STOCK_&tenantIds="
                + tenant.getId()
                + ",999999",
            validToken());
    assertThat(res.statusCode()).isEqualTo(200);
    JsonNode body = objectMapper.readTree(res.body());
    JsonNode entry = body.path(String.valueOf(tenant.getId()));
    assertThat(entry.path("version").isNumber()).isTrue();
    assertThat(entry.path("flags").path("STOCK_MODULE").asBoolean()).isTrue();
    assertThat(entry.path("flags").has("GUIDED_TOUR")).isFalse();
    // Unknown tenants are simply absent.
    assertThat(body.has("999999")).isFalse();
  }

  @Test
  void femmeUserSessionsAndMissingTokensAreRejected() throws Exception {
    String userToken =
        jwtService.createAccessToken(
            1L, tenant.getId(), "admin@salon", UserRole.ADMIN, null, Instant.now());
    String path = "/api/integration/feature-flags/resolved?tenantIds=" + tenant.getId();

    assertThat(get(path, userToken).statusCode()).isEqualTo(401);
    assertThat(get(path, null).statusCode()).isEqualTo(401);
    assertThat(get(path, "garbage").body()).contains("INVALID_TOKEN");
  }

  @Test
  void anIntegrationTokenIsNotAFemmeSession() throws Exception {
    assertThat(get("/api/me", validToken()).statusCode()).isIn(401, 403);
  }
}
