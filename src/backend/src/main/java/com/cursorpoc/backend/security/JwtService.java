package com.cursorpoc.backend.security;

import com.cursorpoc.backend.config.FemmeJwtProperties;
import com.cursorpoc.backend.domain.enums.UserRole;
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
  public static final String CLAIM_ROLE = "role";
  public static final String CLAIM_PROFESSIONAL_ID = "pid";

  /**
   * Issue #310: present (and {@code true}) only on a token the Platform Admin obtained by
   * impersonating a tenant — a tenant-bound {@code ADMIN} token whose subject is still the Platform
   * Admin's own user, so every action taken with it is attributed to them, never to a tenant user.
   */
  public static final String CLAIM_IMPERSONATION = "imp";

  /** HU-66: shared device that issued a PIN session (absent on every other token). */
  public static final String CLAIM_PIN_DEVICE = "pin";

  /** HU-66: PIN version the PIN session was issued for. */
  public static final String CLAIM_PIN_VERSION = "pv";

  /** HU-66: PIN sessions are short-lived; the frontend refreshes them while in use. */
  public static final long PIN_SESSION_TTL_SECONDS = 15 * 60;

  private final FemmeJwtProperties properties;
  private final SecretKey key;

  public JwtService(FemmeJwtProperties properties) {
    this.properties = properties;
    // RT-18: outside e2e/test, absent here means KeyVaultSecretsEnvironmentPostProcessor either
    // didn't run (misconfigured app.femme.keyvault.uri) or Key Vault itself is unreachable at
    // boot — either way this must fail loudly, not silently sign tokens with no real secret.
    if (properties.getSecret() == null) {
      throw new IllegalStateException(
          "FEMME_JWT_SECRET_NOT_CONFIGURED: app.femme.jwt.secret is not set");
    }
    byte[] bytes = properties.getSecret().getBytes(java.nio.charset.StandardCharsets.UTF_8);
    if (bytes.length < 32) {
      throw new IllegalStateException("app.femme.jwt.secret must be at least 32 bytes");
    }
    this.key = Keys.hmacShaKeyFor(bytes);
  }

  /**
   * @param tenantId {@code null} only for {@link UserRole#PLATFORM_ADMIN} (HU-34) — the resulting
   *     token carries no {@code tid} claim at all, not a null/zero one.
   */
  public String createAccessToken(
      long userId,
      Long tenantId,
      String email,
      UserRole role,
      Long professionalId,
      Instant issuedAt) {
    return createAccessToken(userId, tenantId, email, role, professionalId, issuedAt, false);
  }

  /**
   * @param impersonation issue #310 — marks a Platform Admin's impersonation token (see {@link
   *     #CLAIM_IMPERSONATION}); the claim is omitted entirely for a regular session.
   */
  public String createAccessToken(
      long userId,
      Long tenantId,
      String email,
      UserRole role,
      Long professionalId,
      Instant issuedAt,
      boolean impersonation) {
    Instant exp = issuedAt.plusSeconds(properties.getAccessTokenTtlSeconds());
    var builder =
        Jwts.builder()
            .subject(String.valueOf(userId))
            .claim("email", email)
            .claim(CLAIM_ROLE, role.name())
            .issuedAt(Date.from(issuedAt))
            .expiration(Date.from(exp));
    if (tenantId != null) {
      builder.claim(CLAIM_TENANT_ID, tenantId);
    }
    if (professionalId != null) {
      builder.claim(CLAIM_PROFESSIONAL_ID, professionalId);
    }
    if (impersonation) {
      builder.claim(CLAIM_IMPERSONATION, true);
    }
    return builder.signWith(key).compact();
  }

  /** HU-66: token for a professional who entered her PIN on a shared device (calendar only). */
  public String createPinSessionToken(FemmeUserPrincipal pinPrincipal, Instant issuedAt) {
    Instant exp = issuedAt.plusSeconds(PIN_SESSION_TTL_SECONDS);
    return Jwts.builder()
        .subject(String.valueOf(pinPrincipal.getUserId()))
        .claim("email", pinPrincipal.getUsername())
        .claim(CLAIM_ROLE, pinPrincipal.getRole().name())
        .claim(CLAIM_TENANT_ID, pinPrincipal.getTenantId())
        .claim(CLAIM_PROFESSIONAL_ID, pinPrincipal.getProfessionalId())
        .claim(CLAIM_PIN_DEVICE, pinPrincipal.getPinDeviceId())
        .claim(CLAIM_PIN_VERSION, pinPrincipal.getPinVersion())
        .issuedAt(Date.from(issuedAt))
        .expiration(Date.from(exp))
        .signWith(key)
        .compact();
  }

  public Optional<FemmeUserPrincipal> parseAndValidate(String token) {
    try {
      Claims claims = Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
      long userId = Long.parseLong(claims.getSubject());
      // HU-34: `tid` is now optional — absent for a PLATFORM_ADMIN token. Whether a *missing*
      // tenant is acceptable for the route being called is enforced downstream by
      // JwtAuthenticationFilter (platform/auth routes only), not here; JwtService only concerns
      // itself with whether the token itself is well-formed and signed correctly.
      Number tid = claims.get(CLAIM_TENANT_ID, Number.class);
      Long tenantId = tid != null ? tid.longValue() : null;
      String email = claims.get("email", String.class);
      if (email == null) {
        return Optional.empty();
      }
      String roleName = claims.get(CLAIM_ROLE, String.class);
      UserRole role;
      try {
        role = roleName != null ? UserRole.valueOf(roleName) : UserRole.ADMIN;
      } catch (IllegalArgumentException e) {
        role = UserRole.ADMIN;
      }
      Number pidClaim = claims.get(CLAIM_PROFESSIONAL_ID, Number.class);
      Long professionalId = pidClaim != null ? pidClaim.longValue() : null;
      boolean impersonation = Boolean.TRUE.equals(claims.get(CLAIM_IMPERSONATION, Boolean.class));
      Number pinDevice = claims.get(CLAIM_PIN_DEVICE, Number.class);
      Number pinVersion = claims.get(CLAIM_PIN_VERSION, Number.class);
      if (pinDevice != null) {
        // HU-66: a PIN session is always a tenant-bound PROFESSIONAL session.
        if (tenantId == null || professionalId == null || role != UserRole.PROFESSIONAL) {
          return Optional.empty();
        }
        return Optional.of(
            FemmeUserPrincipal.pinSession(
                tenantId,
                professionalId,
                pinDevice.longValue(),
                pinVersion == null ? 0 : pinVersion.intValue()));
      }
      return Optional.of(
          new FemmeUserPrincipal(userId, tenantId, email, role, professionalId, impersonation));
    } catch (RuntimeException ex) {
      return Optional.empty();
    }
  }
}
