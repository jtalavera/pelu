package com.cursorpoc.backend.stock;

import com.cursorpoc.backend.config.StockProperties;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Arrays;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import javax.crypto.SecretKey;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * Stock integration (HU-61): OAuth2 {@code client_credentials} for the single technical user
 * control-stock uses to pull flags. The only grantable scope is {@code flags:read}. Tokens are
 * HS256 JWTs signed with their own secret ({@code app.femme.stock.integration.token-secret}) —
 * never the Femme session secret, so an integration token can never pass as a user session and vice
 * versa.
 */
@Service
public class IntegrationTokenService {

  public static final String SCOPE_FLAGS_READ = "flags:read";

  static final List<String> GRANTABLE_SCOPES = List.of(SCOPE_FLAGS_READ);

  private static final String ISSUER = "femme-integration";

  private static final String TYP = "integration";

  private final StockProperties properties;

  public IntegrationTokenService(StockProperties properties) {
    this.properties = properties;
  }

  /** The authenticated technical user of an integration request. */
  public record IntegrationPrincipal(String clientId, Set<String> scopes) {
    public boolean hasScope(String scope) {
      return scopes.contains(scope);
    }
  }

  public record IssuedToken(String accessToken, long expiresInSeconds, String scope) {}

  public IssuedToken issue(String grantType, String clientId, String clientSecret, String scope) {
    if (!"client_credentials".equals(grantType)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "UNSUPPORTED_GRANT_TYPE");
    }
    StockProperties.Integration config = properties.getIntegration();
    if (isBlank(config.getClientSecret()) || isBlank(config.getTokenSecret())) {
      throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "STOCK_NOT_CONFIGURED");
    }
    if (clientId == null
        || clientSecret == null
        || !constantTimeEquals(clientId, config.getClientId())
        || !constantTimeEquals(clientSecret, config.getClientSecret())) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "INVALID_CLIENT");
    }
    Set<String> granted = new LinkedHashSet<>(GRANTABLE_SCOPES);
    if (!isBlank(scope)) {
      Set<String> requested =
          new LinkedHashSet<>(
              Arrays.stream(scope.trim().split("\\s+")).filter(s -> !s.isBlank()).toList());
      if (!granted.containsAll(requested)) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_SCOPE");
      }
      granted = requested;
    }
    Instant now = Instant.now();
    Instant exp = now.plus(config.getTokenTtl());
    String token =
        Jwts.builder()
            .issuer(ISSUER)
            .subject(config.getClientId())
            .claim("typ", TYP)
            .claim("scope", String.join(" ", granted))
            .issuedAt(Date.from(now))
            .expiration(Date.from(exp))
            .signWith(key())
            .compact();
    return new IssuedToken(token, config.getTokenTtl().toSeconds(), String.join(" ", granted));
  }

  public Optional<IntegrationPrincipal> verify(String token) {
    if (isBlank(properties.getIntegration().getTokenSecret()) || isBlank(token)) {
      return Optional.empty();
    }
    try {
      Claims claims =
          Jwts.parser()
              .verifyWith(key())
              .requireIssuer(ISSUER)
              .build()
              .parseSignedClaims(token)
              .getPayload();
      if (!TYP.equals(claims.get("typ", String.class))) {
        return Optional.empty();
      }
      String scope = claims.get("scope", String.class);
      Set<String> scopes =
          scope == null ? Set.of() : new LinkedHashSet<>(Arrays.asList(scope.trim().split("\\s+")));
      return Optional.of(new IntegrationPrincipal(claims.getSubject(), scopes));
    } catch (JwtException | IllegalArgumentException e) {
      return Optional.empty();
    }
  }

  private SecretKey key() {
    byte[] bytes = properties.getIntegration().getTokenSecret().getBytes(StandardCharsets.UTF_8);
    if (bytes.length < 32) {
      throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "STOCK_NOT_CONFIGURED");
    }
    return Keys.hmacShaKeyFor(bytes);
  }

  private static boolean constantTimeEquals(String a, String b) {
    if (b == null) {
      return false;
    }
    return MessageDigest.isEqual(
        a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
  }

  private static boolean isBlank(String s) {
    return s == null || s.isBlank();
  }
}
