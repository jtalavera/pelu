package com.cursorpoc.backend.stock;

import com.cursorpoc.backend.stock.IntegrationTokenService.IntegrationPrincipal;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Stock integration (HU-61): guards {@code /api/integration/**} (except the token endpoint). Only
 * an integration token from {@link IntegrationTokenService} authenticates here — a Femme user
 * session never does (the JWT filter skips this prefix), so a salon user can never read another
 * tenant's flags through it. Anything else is answered {@code 401 INVALID_TOKEN} right here.
 */
public class IntegrationAuthenticationFilter extends OncePerRequestFilter {

  private static final Logger log = LoggerFactory.getLogger(IntegrationAuthenticationFilter.class);

  public static final String PREFIX = "/api/integration/";
  public static final String TOKEN_PATH = PREFIX + "oauth/token";

  private final IntegrationTokenService tokenService;

  public IntegrationAuthenticationFilter(IntegrationTokenService tokenService) {
    this.tokenService = tokenService;
  }

  @Override
  protected boolean shouldNotFilter(HttpServletRequest request) {
    String path = request.getRequestURI();
    return !path.startsWith(PREFIX) || path.equals(TOKEN_PATH);
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
      throws ServletException, IOException {
    String header = request.getHeader(HttpHeaders.AUTHORIZATION);
    Optional<IntegrationPrincipal> principal =
        header != null && header.startsWith("Bearer ")
            ? tokenService.verify(header.substring(7))
            : Optional.empty();
    if (principal.isEmpty()) {
      log.error(
          "{} {} tenantId=null status=401 error=INVALID_TOKEN",
          request.getMethod(),
          request.getRequestURI());
      response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
      response.setContentType(MediaType.APPLICATION_JSON_VALUE);
      response.getWriter().write("{\"error\":\"INVALID_TOKEN\"}");
      return;
    }
    List<SimpleGrantedAuthority> authorities =
        principal.get().scopes().stream()
            .map(s -> new SimpleGrantedAuthority("SCOPE_" + s))
            .toList();
    UsernamePasswordAuthenticationToken auth =
        new UsernamePasswordAuthenticationToken(principal.get(), null, authorities);
    SecurityContextHolder.getContext().setAuthentication(auth);
    filterChain.doFilter(request, response);
  }
}
