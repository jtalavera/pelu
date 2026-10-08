package com.cursorpoc.backend.web.filter;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.cursorpoc.backend.domain.enums.UserRole;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.AuditLogService;
import jakarta.servlet.FilterChain;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.servlet.HandlerMapping;

/** Issue #284: which requests the audit filter records. */
class AuditLogFilterTest {

  private static final FemmeUserPrincipal ADMIN =
      new FemmeUserPrincipal(2L, 7L, "admin@salon.test", UserRole.ADMIN, null);

  private final AuditLogService service = mock(AuditLogService.class);
  private final AuditLogFilter filter = new AuditLogFilter(service);

  @AfterEach
  void clear() {
    SecurityContextHolder.clearContext();
  }

  private static void authenticate(FemmeUserPrincipal principal) {
    SecurityContextHolder.getContext()
        .setAuthentication(new UsernamePasswordAuthenticationToken(principal, null, List.of()));
  }

  private static MockHttpServletRequest request(
      String method, String pattern, Map<String, String> vars) {
    MockHttpServletRequest request =
        new MockHttpServletRequest(method, pattern.replace("{id}", "42"));
    request.setAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE, pattern);
    request.setAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE, vars);
    return request;
  }

  private void run(MockHttpServletRequest request, int status) throws Exception {
    MockHttpServletResponse response = new MockHttpServletResponse();
    FilterChain chain = (req, res) -> ((MockHttpServletResponse) res).setStatus(status);
    filter.doFilter(request, response, chain);
  }

  @Test
  void recordsASuccessfulDataChange_withTheRecordIdFromTheUrl() throws Exception {
    authenticate(ADMIN);

    run(request("POST", "/api/invoices/{id}/void", Map.of("id", "42")), 200);

    verify(service).record(eq(ADMIN), eq("POST"), eq("/api/invoices/{id}/void"), eq("42"), eq(200));
  }

  @Test
  void theTenantIdInAPlatformUrlIsNotTheAffectedRecord() throws Exception {
    authenticate(new FemmeUserPrincipal(1L, null, "root@pelu", UserRole.PLATFORM_ADMIN, null));

    run(
        request(
            "POST",
            "/api/platform/tenants/{tenantId}/sifen/csc/{idCsc}/activate",
            new java.util.LinkedHashMap<>(Map.of("tenantId", "7", "idCsc", "5"))),
        200);

    verify(service).record(any(), eq("POST"), anyString(), eq("5"), eq(200));
  }

  @Test
  void ignoresReads_failures_unauthenticatedCalls_andExcludedEndpoints() throws Exception {
    authenticate(ADMIN);
    run(request("GET", "/api/invoices", Map.of()), 200);
    run(request("POST", "/api/invoices", Map.of()), 400);
    run(request("POST", "/api/invoices", Map.of()), 403);
    run(request("POST", "/api/auth/refresh", Map.of()), 200);
    SecurityContextHolder.clearContext();
    run(request("POST", "/api/invoices", Map.of()), 201);

    verify(service, never()).record(any(), anyString(), anyString(), any(), anyInt());
  }

  @Test
  void aRequestThatEndsInAnException_isNotRecorded() throws Exception {
    authenticate(ADMIN);
    FilterChain chain =
        (req, res) -> {
          throw new IllegalStateException("boom");
        };
    try {
      filter.doFilter(
          request("POST", "/api/invoices", Map.of()), new MockHttpServletResponse(), chain);
    } catch (IllegalStateException expected) {
      // propagated untouched
    }

    verify(service, never()).record(any(), anyString(), anyString(), any(), anyInt());
  }
}
