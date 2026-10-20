package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeJwtProperties;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.TenantStatus;
import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.security.JwtService;
import com.cursorpoc.backend.web.dto.TokenResponse;
import java.time.Instant;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Issue #310: the Platform Admin impersonates a tenant administrator. Only the tenant is chosen —
 * not one of its admins — so this works even for a tenant whose admins have not activated their
 * accounts yet. The issued token is a regular tenant-bound {@code ADMIN} token (so it reaches every
 * tenant-admin feature through the very same routes and checks) whose subject and email stay the
 * Platform Admin's own, flagged with {@link JwtService#CLAIM_IMPERSONATION}: every action taken
 * with it is attributed to the Platform Admin, and the token never reaches a platform route.
 */
@Service
public class PlatformImpersonationService {

  private final TenantRepository tenantRepository;
  private final JwtService jwtService;
  private final FemmeJwtProperties jwtProperties;

  public PlatformImpersonationService(
      TenantRepository tenantRepository, JwtService jwtService, FemmeJwtProperties jwtProperties) {
    this.tenantRepository = tenantRepository;
    this.jwtService = jwtService;
    this.jwtProperties = jwtProperties;
  }

  /**
   * @throws ResponseStatusException 404 {@code TENANT_NOT_FOUND}; 409 {@code TENANT_SUSPENDED} (a
   *     suspended tenant's tokens are rejected on every request anyway — HU-40 AC-3)
   */
  @Transactional(readOnly = true)
  public TokenResponse impersonateTenantAdmin(FemmeUserPrincipal platformAdmin, long tenantId) {
    Tenant tenant =
        tenantRepository
            .findById(tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND"));
    if (tenant.getStatus() == TenantStatus.SUSPENDED) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "TENANT_SUSPENDED");
    }
    String token =
        jwtService.createAccessToken(
            platformAdmin.getUserId(),
            tenant.getId(),
            platformAdmin.getUsername(),
            UserRole.ADMIN,
            null,
            Instant.now(),
            true);
    return new TokenResponse(token, jwtProperties.getAccessTokenTtlSeconds(), "Bearer");
  }
}
