package com.cursorpoc.backend.security;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.domain.enums.UserRole;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

/** RT-21 (Hardening_SIFEN.md). */
class CorrelationIdFilterTest {

  private final CorrelationIdFilter filter = new CorrelationIdFilter();

  @AfterEach
  void tearDown() {
    SecurityContextHolder.clearContext();
    MDC.clear();
  }

  @Test
  void doFilter_generatesACorrelationId_whenNoneIsSent() throws Exception {
    MockHttpServletRequest request = new MockHttpServletRequest();
    MockHttpServletResponse response = new MockHttpServletResponse();
    MockFilterChain chain = new MockFilterChain();

    filter.doFilter(request, response, chain);

    String generated = response.getHeader(CorrelationIdFilter.CORRELATION_ID_HEADER);
    assertThat(generated).isNotBlank();
    assertThat(UUID.fromString(generated)).isNotNull();
  }

  @Test
  void doFilter_honorsAnIncomingCorrelationId_insteadOfGeneratingOne() throws Exception {
    MockHttpServletRequest request = new MockHttpServletRequest();
    request.addHeader(CorrelationIdFilter.CORRELATION_ID_HEADER, "client-supplied-id");
    MockHttpServletResponse response = new MockHttpServletResponse();
    MockFilterChain chain = new MockFilterChain();

    filter.doFilter(request, response, chain);

    assertThat(response.getHeader(CorrelationIdFilter.CORRELATION_ID_HEADER))
        .isEqualTo("client-supplied-id");
  }

  @Test
  void doFilter_putsTenantIdInMdc_whenAlreadyAuthenticated() throws Exception {
    FemmeUserPrincipal principal =
        new FemmeUserPrincipal(7L, 42L, "demo@example.com", UserRole.ADMIN, null);
    SecurityContextHolder.getContext()
        .setAuthentication(
            new UsernamePasswordAuthenticationToken(principal, null, principal.getAuthorities()));
    MockHttpServletRequest request = new MockHttpServletRequest();
    MockHttpServletResponse response = new MockHttpServletResponse();
    String[] tenantIdDuringChain = new String[1];
    MockFilterChain chain =
        new MockFilterChain() {
          @Override
          public void doFilter(
              jakarta.servlet.ServletRequest req, jakarta.servlet.ServletResponse res) {
            tenantIdDuringChain[0] = MDC.get(CorrelationIdFilter.MDC_TENANT_ID);
          }
        };

    filter.doFilter(request, response, chain);

    assertThat(tenantIdDuringChain[0]).isEqualTo("42");
  }

  @Test
  void doFilter_clearsMdc_afterTheChainCompletes() throws Exception {
    MockHttpServletRequest request = new MockHttpServletRequest();
    MockHttpServletResponse response = new MockHttpServletResponse();
    MockFilterChain chain = new MockFilterChain();

    filter.doFilter(request, response, chain);

    assertThat(MDC.get(CorrelationIdFilter.MDC_CORRELATION_ID)).isNull();
    assertThat(MDC.get(CorrelationIdFilter.MDC_TENANT_ID)).isNull();
  }
}
