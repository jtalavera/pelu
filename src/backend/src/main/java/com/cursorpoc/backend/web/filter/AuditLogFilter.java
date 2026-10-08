package com.cursorpoc.backend.web.filter;

import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.AuditLogService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Map;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.servlet.HandlerMapping;

/**
 * Issue #284: feeds the audit trail. After the request has been handled, a successful (2xx/3xx)
 * data-changing call (POST/PUT/PATCH/DELETE) by an authenticated user is recorded with who did it,
 * which endpoint (the URL template, not the concrete URL) and which record (the id in the URL).
 * Request bodies are never read or stored. Runs inside the Spring Security chain, next to {@link
 * ApiEndpointLoggingFilter}, so the authenticated principal is still available.
 */
@Component
@Order(Ordered.LOWEST_PRECEDENCE - 9)
public class AuditLogFilter extends OncePerRequestFilter {

  private final AuditLogService auditLogService;

  public AuditLogFilter(AuditLogService auditLogService) {
    this.auditLogService = auditLogService;
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
      throws ServletException, IOException {
    boolean completed = false;
    try {
      filterChain.doFilter(request, response);
      completed = true;
    } finally {
      // An exception that escapes the chain leaves the response status unset (still 200): that
      // request failed, so it is not part of the trail.
      if (completed) {
        audit(request, response);
      }
    }
  }

  private void audit(HttpServletRequest request, HttpServletResponse response) {
    int status = response.getStatus();
    if (status < 200 || status >= 400) {
      return;
    }
    Object pattern = request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
    if (!(pattern instanceof String template)
        || !AuditLogService.isAuditable(request.getMethod(), template)) {
      return;
    }
    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
    if (auth == null || !(auth.getPrincipal() instanceof FemmeUserPrincipal principal)) {
      return;
    }
    auditLogService.record(principal, request.getMethod(), template, entityId(request), status);
  }

  /** The record the URL points to: the last path variable that is not the tenant's own id. */
  @SuppressWarnings("unchecked")
  private static String entityId(HttpServletRequest request) {
    Object vars = request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE);
    if (!(vars instanceof Map<?, ?> map) || map.isEmpty()) {
      return null;
    }
    String last = null;
    for (Map.Entry<String, String> e : ((Map<String, String>) map).entrySet()) {
      if (!"tenantId".equals(e.getKey())) {
        last = e.getValue();
      }
    }
    return last;
  }
}
