package com.cursorpoc.backend.stock;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.StockProperties;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-65: the handoff token must pass control-stock's {@code HostTokenVerifier} — same parser setup
 * (HS256 with the dedicated secret, {@code requireAudience("control-stock")}, {@code
 * requireIssuer}) and the claims it reads ({@code sub}, {@code tid}, {@code email}, {@code role}).
 */
class StockSsoServiceTest {

  private static final String SECRET = "e2e-pelu-handoff-secret-min-32-characters!!";

  private StockProperties properties;
  private StockOutboxService outbox;
  private StockSsoService service;

  @BeforeEach
  void setUp() {
    properties = new StockProperties();
    properties.getSso().setSecret(SECRET);
    properties.getSso().setIssuer("femme");
    outbox = mock(StockOutboxService.class);
    when(outbox.stockEnabled(17L)).thenReturn(true);
    service = new StockSsoService(properties, outbox);
  }

  /** Mirrors control-stock HostTokenVerifier#verify. */
  private Claims verifyLikeStock(String token) {
    return Jwts.parser()
        .requireAudience("control-stock")
        .requireIssuer("femme")
        .verifyWith(Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8)))
        .build()
        .parseSignedClaims(token)
        .getPayload();
  }

  @Test
  void adminTokenCarriesTheClaimsStockMapsToStockAdmin() {
    StockSsoService.SsoToken token =
        service.issue(new FemmeUserPrincipal(5L, 17L, "admin@salon.py", UserRole.ADMIN, null));

    Claims claims = verifyLikeStock(token.token());
    assertThat(claims.getSubject()).isEqualTo("5");
    assertThat(String.valueOf(claims.get("tid"))).isEqualTo("17");
    assertThat(claims.get("email", String.class)).isEqualTo("admin@salon.py");
    assertThat(claims.get("role", String.class)).isEqualTo("ADMIN");
    assertThat(token.expiresInSeconds()).isEqualTo(300);
    long ttl = (claims.getExpiration().getTime() - claims.getIssuedAt().getTime()) / 1000;
    assertThat(ttl).isEqualTo(Duration.ofMinutes(5).toSeconds());
  }

  @Test
  void professionalTokenCarriesItsProfessionalId() {
    Claims claims =
        verifyLikeStock(
            service
                .issue(new FemmeUserPrincipal(6L, 17L, "pro@salon.py", UserRole.PROFESSIONAL, 44L))
                .token());
    assertThat(claims.get("role", String.class)).isEqualTo("PROFESSIONAL");
    assertThat(claims.get("pid", String.class)).isEqualTo("44");
  }

  @Test
  void tokenIsNotValidWithTheWrongSecret() {
    String token =
        service.issue(new FemmeUserPrincipal(5L, 17L, "a@b.py", UserRole.ADMIN, null)).token();
    assertThatThrownBy(
            () ->
                Jwts.parser()
                    .verifyWith(
                        Keys.hmacShaKeyFor(
                            "another-secret-of-at-least-32-characters!!"
                                .getBytes(StandardCharsets.UTF_8)))
                    .build()
                    .parseSignedClaims(token))
        .isInstanceOf(io.jsonwebtoken.security.SignatureException.class);
  }

  @Test
  void tenantWithoutStockModuleIsRejected() {
    when(outbox.stockEnabled(18L)).thenReturn(false);
    assertThatThrownBy(
            () -> service.issue(new FemmeUserPrincipal(5L, 18L, "a@b.py", UserRole.ADMIN, null)))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("STOCK_MODULE_DISABLED");
  }

  @Test
  void platformAdminIsRejected() {
    assertThatThrownBy(
            () ->
                service.issue(
                    new FemmeUserPrincipal(1L, 17L, "root@pelu", UserRole.PLATFORM_ADMIN, null)))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("FORBIDDEN");
  }

  @Test
  void missingSecretIsStockNotConfigured() {
    properties.getSso().setSecret(null);
    assertThatThrownBy(
            () -> service.issue(new FemmeUserPrincipal(5L, 17L, "a@b.py", UserRole.ADMIN, null)))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("STOCK_NOT_CONFIGURED");
  }
}
