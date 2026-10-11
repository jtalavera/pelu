package com.cursorpoc.backend.stock;

import com.cursorpoc.backend.config.StockProperties;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * Stock integration (HU-65): short-lived (5 min) handoff token the Stock SPA exchanges for its own
 * session. HS256 with a secret shared only with control-stock ({@code app-femme-stock-sso-secret}),
 * never the Femme session secret. Claims match control-stock's {@code HostTokenVerifier}: {@code
 * iss}, {@code aud=control-stock}, {@code sub}, {@code email}, {@code role} (ADMIN → Stock admin,
 * PROFESSIONAL → operator), {@code tid} (pelu tenant id) and {@code pid}.
 */
@Service
public class StockSsoService {

  private final StockProperties properties;
  private final StockOutboxService outbox;

  public StockSsoService(StockProperties properties, StockOutboxService outbox) {
    this.properties = properties;
    this.outbox = outbox;
  }

  public record SsoToken(String token, long expiresInSeconds) {}

  public SsoToken issue(FemmeUserPrincipal principal) {
    if (principal.getRole() != UserRole.ADMIN && principal.getRole() != UserRole.PROFESSIONAL) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "FORBIDDEN");
    }
    if (!outbox.stockEnabled(principal.getTenantId())) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "STOCK_MODULE_DISABLED");
    }
    StockProperties.Sso sso = properties.getSso();
    String secret = sso.getSecret();
    if (secret == null || secret.getBytes(StandardCharsets.UTF_8).length < 32) {
      throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "STOCK_NOT_CONFIGURED");
    }
    Instant now = Instant.now();
    var builder =
        Jwts.builder()
            .id(UUID.randomUUID().toString())
            .issuer(sso.getIssuer())
            .audience()
            .add(sso.getAudience())
            .and()
            .subject(String.valueOf(principal.getUserId()))
            .claim("email", principal.getUsername())
            .claim("role", principal.getRole().name())
            .claim("tid", String.valueOf(principal.getTenantId()))
            .issuedAt(Date.from(now))
            .expiration(Date.from(now.plus(sso.getTtl())));
    if (principal.getProfessionalId() != null) {
      builder.claim("pid", String.valueOf(principal.getProfessionalId()));
    }
    String token =
        builder.signWith(Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8))).compact();
    return new SsoToken(token, sso.getTtl().toSeconds());
  }
}
