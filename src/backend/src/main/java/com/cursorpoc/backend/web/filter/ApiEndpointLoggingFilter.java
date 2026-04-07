package com.cursorpoc.backend.web.filter;

import com.cursorpoc.backend.security.FemmeUserPrincipal;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@Order(Ordered.LOWEST_PRECEDENCE - 10)
public class ApiEndpointLoggingFilter extends OncePerRequestFilter {

  private static final Logger log = LoggerFactory.getLogger(ApiEndpointLoggingFilter.class);

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
      throws ServletException, IOException {
    String path = request.getRequestURI();
    String method = request.getMethod();
    try {
      filterChain.doFilter(request, response);
    } finally {
      String tenantAfter = resolveTenantId();
      log.info("request: path={} method={} tenantId={}", path, method, tenantAfter);
      int status = response.getStatus();
      if (status >= 200 && status < 400) {
        log.info(
            "response: path={} method={} tenantId={} status={}", path, method, tenantAfter, status);
      } else if (status != 0) {
        log.error(
            "response: path={} method={} tenantId={} status={}", path, method, tenantAfter, status);
      }
    }
  }

  private static String resolveTenantId() {
    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
    if (auth != null && auth.getPrincipal() instanceof FemmeUserPrincipal p) {
      return String.valueOf(p.getTenantId());
    }
    return "-";
  }
}
