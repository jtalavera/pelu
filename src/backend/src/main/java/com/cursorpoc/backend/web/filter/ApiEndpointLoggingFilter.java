package com.cursorpoc.backend.web.filter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class ApiEndpointLoggingFilter extends OncePerRequestFilter {

  private static final Logger log = LoggerFactory.getLogger(ApiEndpointLoggingFilter.class);

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
      throws ServletException, IOException {
    String path = request.getRequestURI();
    String method = request.getMethod();
    String tenantId = "-";
    log.info("request: path={} method={} tenantId={}", path, method, tenantId);
    try {
      filterChain.doFilter(request, response);
    } finally {
      int status = response.getStatus();
      if (status >= 200 && status < 400) {
        log.info(
            "response: path={} method={} tenantId={} status={}", path, method, tenantId, status);
      } else if (status != 0) {
        log.error(
            "response: path={} method={} tenantId={} status={}", path, method, tenantId, status);
      }
    }
  }
}
