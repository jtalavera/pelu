package com.cursorpoc.backend.security;

import com.cursorpoc.backend.domain.enums.TenantStatus;
import com.cursorpoc.backend.repository.TenantRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.web.filter.OncePerRequestFilter;

public class JwtAuthenticationFilter extends OncePerRequestFilter {

  /**
   * HU-34 AC-3/AC-4, extended by HU-35 and HU-36: the only path prefixes allowed to authenticate a
   * tenant-less (PLATFORM_ADMIN) token. {@code /api/platform/**} is the explicit platform area
   * (AC-5: Platform Admin never reaches tenant business data via a bypass on tenant-scoped routes,
   * only through these new routes); {@code /api/auth/**} is session plumbing (login/refresh), not
   * tenant-scoped business data, so a Platform Admin must still be able to refresh their own
   * session. {@code /api/me} (HU-35) is generic "who am I" identity, not tenant business data
   * either — the frontend's route guard for {@code /platform/**} needs it to resolve the current
   * user's role. {@code /api/admin/feature-flags} (HU-36) is the explicit platform route for global
   * and per-tenant feature-flag/SIFEN-homologación administration — it migrated here from the
   * retired {@code SYSTEM_ADMIN} role, which used to reach the very same paths via a tenant-bound
   * token plus a {@code TenantPathAccess} bypass (also retired); {@link
   * com.cursorpoc.backend.web.FeatureFlagController} gates every one of these endpoints to {@code
   * PLATFORM_ADMIN} and treats each {@code {tenantId}} path segment as an explicit, deliberate
   * target rather than matching it against the caller's own (nonexistent) tenant. Every other route
   * — unchanged from before HU-34 — keeps rejecting a token without {@code tid}, for every role.
   */
  private static final String[] TENANT_OPTIONAL_PATH_PREFIXES = {
    "/api/platform/", "/api/auth/", "/api/me", "/api/admin/feature-flags"
  };

  private static final Logger log = LoggerFactory.getLogger(JwtAuthenticationFilter.class);

  private final JwtService jwtService;
  private final TenantRepository tenantRepository;

  public JwtAuthenticationFilter(JwtService jwtService, TenantRepository tenantRepository) {
    this.jwtService = jwtService;
    this.tenantRepository = tenantRepository;
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
      throws ServletException, IOException {
    String header = request.getHeader(HttpHeaders.AUTHORIZATION);
    if (header != null && header.startsWith("Bearer ")) {
      String token = header.substring(7);
      jwtService
          .parseAndValidate(token)
          .ifPresent(
              principal -> {
                if (!principal.hasTenant() && !isTenantOptionalPath(request.getRequestURI())) {
                  // No tid + a route that isn't in the platform/auth allowlist: leave the
                  // SecurityContext unauthenticated, exactly as before HU-34 (when JwtService
                  // itself rejected any tid-less token outright) — SecurityConfig's
                  // anyRequest().authenticated() then rejects it with 403 (Spring Security's
                  // default for an anonymous/no-authentication request; same status pre-HU-34
                  // gave any invalid or missing token), for every role, not just PLATFORM_ADMIN.
                  return;
                }
                // HU-40 AC-3: a tenant-bound token stops working on the very next request once its
                // tenant is SUSPENDED — the JWT itself is stateless/still valid, so this
                // per-request
                // DB check is what actually invalidates an already-issued token rather than waiting
                // for it to expire naturally. Left unauthenticated here, exactly like the tid-less
                // case above, so every route (not just tenant-scoped ones) rejects it the same way.
                if (principal.hasTenant() && isTenantSuspended(principal.getTenantId())) {
                  log.warn(
                      "request rejected: tenant suspended tenantId={} path={}",
                      principal.getTenantId(),
                      request.getRequestURI());
                  return;
                }
                UsernamePasswordAuthenticationToken auth =
                    new UsernamePasswordAuthenticationToken(
                        principal, null, principal.getAuthorities());
                auth.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
                SecurityContextHolder.getContext().setAuthentication(auth);
              });
    }
    filterChain.doFilter(request, response);
  }

  private boolean isTenantSuspended(long tenantId) {
    return tenantRepository
        .findById(tenantId)
        .map(t -> t.getStatus() == TenantStatus.SUSPENDED)
        .orElse(false);
  }

  private static boolean isTenantOptionalPath(String requestUri) {
    for (String prefix : TENANT_OPTIONAL_PATH_PREFIXES) {
      if (requestUri.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  }
}
