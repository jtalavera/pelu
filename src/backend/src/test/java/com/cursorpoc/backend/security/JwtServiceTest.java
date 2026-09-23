package com.cursorpoc.backend.security;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.config.FemmeJwtProperties;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * HU-34: covers AC-3 (a PLATFORM_ADMIN token carries no {@code tid} claim and parses as valid) and
 * AC-4 (every other role keeps minting/parsing a {@code tid} claim exactly as before).
 */
class JwtServiceTest {

  private JwtService jwtService;

  @BeforeEach
  void setUp() {
    FemmeJwtProperties props = new FemmeJwtProperties();
    props.setSecret("unit-test-jwt-secret-min-32-characters-long!!");
    props.setAccessTokenTtlSeconds(28_800L);
    jwtService = new JwtService(props);
  }

  @Test
  void platformAdminToken_hasNoTidClaim_andParsesWithNullTenant() {
    String token =
        jwtService.createAccessToken(
            1L, null, "platform-admin@pelu", UserRole.PLATFORM_ADMIN, null, Instant.now());

    // Assert directly on the raw claims that `tid` is genuinely absent, not just null-ish.
    assertThat(decodePayload(token)).doesNotContainKey(JwtService.CLAIM_TENANT_ID);

    Optional<FemmeUserPrincipal> parsed = jwtService.parseAndValidate(token);
    assertThat(parsed).isPresent();
    FemmeUserPrincipal principal = parsed.get();
    assertThat(principal.hasTenant()).isFalse();
    assertThat(principal.getTenantIdOrNull()).isNull();
    assertThat(principal.isPlatformAdmin()).isTrue();
    assertThat(principal.getRole()).isEqualTo(UserRole.PLATFORM_ADMIN);
  }

  @Test
  void platformAdminPrincipal_getTenantId_throws() {
    String token =
        jwtService.createAccessToken(
            1L, null, "platform-admin@pelu", UserRole.PLATFORM_ADMIN, null, Instant.now());
    FemmeUserPrincipal principal = jwtService.parseAndValidate(token).orElseThrow();
    org.assertj.core.api.Assertions.assertThatThrownBy(principal::getTenantId)
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  void adminToken_stillHasTidClaim_andParsesWithTenant() {
    String token =
        jwtService.createAccessToken(
            2L, 7L, "admin@tenant.test", UserRole.ADMIN, null, Instant.now());

    assertThat(decodePayload(token)).containsEntry(JwtService.CLAIM_TENANT_ID, 7);

    FemmeUserPrincipal principal = jwtService.parseAndValidate(token).orElseThrow();
    assertThat(principal.hasTenant()).isTrue();
    assertThat(principal.getTenantId()).isEqualTo(7L);
  }

  /** Decodes the JWT payload segment (no signature verification) just to inspect raw claim keys. */
  private static Map<String, Object> decodePayload(String signedJwt) {
    String[] parts = signedJwt.split("\\.");
    byte[] json = Base64.getUrlDecoder().decode(parts[1]);
    try {
      return new ObjectMapper().readValue(new String(json, StandardCharsets.UTF_8), Map.class);
    } catch (Exception e) {
      throw new RuntimeException(e);
    }
  }
}
