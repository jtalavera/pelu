package com.cursorpoc.backend.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.HttpHeaders;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.web.filter.OncePerRequestFilter;

public class JwtAuthenticationFilter extends OncePerRequestFilter {

  /**
   * HU-34 AC-3/AC-4: the only path prefixes allowed to authenticate a tenant-less (PLATFORM_ADMIN)
   * token. {@code /api/platform/**} is the new explicit platform area (AC-5: Platform Admin never
   * reaches tenant business data via a bypass on tenant-scoped routes, only through these new
   * routes); {@code /api/auth/**} is session plumbing (login/refresh), not tenant-scoped business
   * data, so a Platform Admin must still be able to refresh their own session. Every other route —
   * unchanged from before HU-34 — keeps rejecting a token without {@code tid}, for every role.
   */
  private static final String[] TENANT_OPTIONAL_PATH_PREFIXES = {"/api/platform/", "/api/auth/"};

  private final JwtService jwtService;

  public JwtAuthenticationFilter(JwtService jwtService) {
    this.jwtService = jwtService;
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
                UsernamePasswordAuthenticationToken auth =
                    new UsernamePasswordAuthenticationToken(
                        principal, null, principal.getAuthorities());
                auth.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
                SecurityContextHolder.getContext().setAuthentication(auth);
              });
    }
    filterChain.doFilter(request, response);
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
