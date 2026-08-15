package com.cursorpoc.backend.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import org.slf4j.MDC;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * RT-21 (Hardening_SIFEN.md): reads or generates a correlation id per request and puts it — plus,
 * once resolved, the caller's tenant id — into MDC, so every log line in a request (including the
 * SIFEN client logs {@code [SIFEN req]}/{@code [SIFEN resp]}) can be traced end to end. Registered
 * <b>after</b> {@link JwtAuthenticationFilter} in the chain (see {@code SecurityConfig}), not
 * before — the tenant id only exists once authentication has resolved a {@link FemmeUserPrincipal}.
 * {@link SifenSubmissionQueueListener} sets the same two MDC keys from the queue message on the
 * consumer thread, which never goes through this filter at all.
 */
public class CorrelationIdFilter extends OncePerRequestFilter {

  public static final String CORRELATION_ID_HEADER = "X-Correlation-Id";
  public static final String MDC_CORRELATION_ID = "correlationId";
  public static final String MDC_TENANT_ID = "tenantId";

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
      throws ServletException, IOException {
    String correlationId = request.getHeader(CORRELATION_ID_HEADER);
    if (correlationId == null || correlationId.isBlank()) {
      correlationId = UUID.randomUUID().toString();
    }
    response.setHeader(CORRELATION_ID_HEADER, correlationId);
    MDC.put(MDC_CORRELATION_ID, correlationId);

    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
    if (auth != null && auth.getPrincipal() instanceof FemmeUserPrincipal principal) {
      MDC.put(MDC_TENANT_ID, String.valueOf(principal.getTenantId()));
    }

    try {
      filterChain.doFilter(request, response);
    } finally {
      MDC.remove(MDC_CORRELATION_ID);
      MDC.remove(MDC_TENANT_ID);
    }
  }
}
