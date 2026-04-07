package com.cursorpoc.backend.security;

import com.cursorpoc.backend.config.FemmeJwtProperties;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.time.Instant;
import java.util.Date;
import java.util.Optional;
import javax.crypto.SecretKey;
import org.springframework.stereotype.Service;

@Service
public class JwtService {

  public static final String CLAIM_TENANT_ID = "tid";

  private final FemmeJwtProperties properties;
  private final SecretKey key;

  public JwtService(FemmeJwtProperties properties) {
    this.properties = properties;
    byte[] bytes = properties.getSecret().getBytes(java.nio.charset.StandardCharsets.UTF_8);
    if (bytes.length < 32) {
      throw new IllegalStateException("app.femme.jwt.secret must be at least 32 bytes");
    }
    this.key = Keys.hmacShaKeyFor(bytes);
  }

  public String createAccessToken(long userId, long tenantId, String email, Instant issuedAt) {
    Instant exp = issuedAt.plusSeconds(properties.getAccessTokenTtlSeconds());
    return Jwts.builder()
        .subject(String.valueOf(userId))
        .claim(CLAIM_TENANT_ID, tenantId)
        .claim("email", email)
        .issuedAt(Date.from(issuedAt))
        .expiration(Date.from(exp))
        .signWith(key)
        .compact();
  }

  public Optional<FemmeUserPrincipal> parseAndValidate(String token) {
    try {
      Claims claims = Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
      long userId = Long.parseLong(claims.getSubject());
      Number tid = claims.get(CLAIM_TENANT_ID, Number.class);
      if (tid == null) {
        return Optional.empty();
      }
      long tenantId = tid.longValue();
      String email = claims.get("email", String.class);
      if (email == null) {
        return Optional.empty();
      }
      return Optional.of(new FemmeUserPrincipal(userId, tenantId, email));
    } catch (RuntimeException ex) {
      return Optional.empty();
    }
  }
}
