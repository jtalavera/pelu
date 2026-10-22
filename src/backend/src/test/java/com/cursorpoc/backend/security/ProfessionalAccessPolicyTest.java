package com.cursorpoc.backend.security;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.domain.enums.UserRole;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.web.access.intercept.RequestAuthorizationContext;

/** HU-24 AC-11/12/13 + issue #38: deny-by-default route policy for the PROFESSIONAL role. */
class ProfessionalAccessPolicyTest {

  private static final FemmeUserPrincipal ADMIN =
      new FemmeUserPrincipal(2L, 7L, "admin@salon.test", UserRole.ADMIN, null);
  private static final FemmeUserPrincipal PROFESSIONAL =
      new FemmeUserPrincipal(3L, 7L, "pro@salon.test", UserRole.PROFESSIONAL, 9L);

  private final ProfessionalAccessPolicy policy = new ProfessionalAccessPolicy();

  private static Authentication auth(FemmeUserPrincipal principal) {
    return new UsernamePasswordAuthenticationToken(principal, null, principal.getAuthorities());
  }

  private boolean allowed(Authentication auth, String method, String uri) {
    MockHttpServletRequest request = new MockHttpServletRequest(method, uri);
    request.setRequestURI(uri);
    return policy.authorize(() -> auth, new RequestAuthorizationContext(request)).isGranted();
  }

  @ParameterizedTest
  @CsvSource({
    "GET, /api/me",
    "PUT, /api/me/profile",
    "POST, /api/me/change-password",
    "GET, /api/me/tour-state",
    "POST, /api/me/tour-state/calendar",
    "GET, /api/feature-flags",
    "GET, /api/appointments",
    "GET, /api/appointments/12",
    "POST, /api/appointments",
    "PUT, /api/appointments/12",
    "PATCH, /api/appointments/12/status",
    "GET, /api/professionals",
    "GET, /api/services",
    "GET, /api/clients",
    "GET, /api/clients/3/technical-sheet",
    "PUT, /api/clients/3/technical-sheet",
    "GET, /api/commissions/me",
    "GET, /api/commissions/me/settlements/5",
  })
  void professional_reachesCalendarProfileAndOwnCommissions(String method, String uri) {
    assertThat(allowed(auth(PROFESSIONAL), method, uri)).isTrue();
  }

  @ParameterizedTest
  @CsvSource({
    "GET, /api/appointments/history",
    "GET, /api/professionals/page",
    "PUT, /api/professionals/9",
    "POST, /api/professionals/9/grant-access",
    "POST, /api/clients",
    "PUT, /api/clients/3",
    "GET, /api/clients/3",
    "GET, /api/clients/3/summary",
    "POST, /api/clients/3/technical-sheet",
    "POST, /api/services",
    "GET, /api/services/price-list/pdf",
    "GET, /api/business-profile",
    "PUT, /api/business-profile",
    "GET, /api/cash-sessions/current",
    "POST, /api/cash-sessions/open",
    "GET, /api/invoices",
    "POST, /api/invoices",
    "GET, /api/dashboard",
    "GET, /api/propinas/balance",
    "GET, /api/service-records",
    "GET, /api/commissions/settlements",
    "GET, /api/commissions/entries",
    "GET, /api/audit",
    "GET, /api/taxes",
    "GET, /api/fiscal-stamps",
    "POST, /api/sso/stock",
    "GET, /api/stock/availability",
  })
  void professional_isDeniedEverythingElse(String method, String uri) {
    assertThat(allowed(auth(PROFESSIONAL), method, uri)).isFalse();
  }

  @Test
  void otherRoles_keepTheAuthenticatedRule() {
    for (String uri : List.of("/api/invoices", "/api/dashboard", "/api/sso/stock")) {
      assertThat(allowed(auth(ADMIN), "GET", uri)).isTrue();
    }
    Authentication integration =
        new UsernamePasswordAuthenticationToken(
            "stock-technical-user", null, List.of(new SimpleGrantedAuthority("ROLE_INTEGRATION")));
    assertThat(allowed(integration, "GET", "/api/integration/feature-flags/resolved")).isTrue();
  }

  @Test
  void anonymous_isDenied() {
    Authentication anonymous =
        new AnonymousAuthenticationToken(
            "key", "anonymousUser", List.of(new SimpleGrantedAuthority("ROLE_ANONYMOUS")));
    assertThat(allowed(anonymous, "GET", "/api/me")).isFalse();
    assertThat(allowed(null, "GET", "/api/me")).isFalse();
  }

  @Test
  void pinSession_reachesTechnicalSheetButNotTheFullProfile() {
    FemmeUserPrincipal pin =
        new FemmeUserPrincipal(3L, 7L, "pro@salon.test", UserRole.PROFESSIONAL, 9L, false, 4L, 1);
    assertThat(allowed(auth(pin), "GET", "/api/clients/3/technical-sheet")).isTrue();
    assertThat(allowed(auth(pin), "PUT", "/api/clients/3/technical-sheet")).isTrue();
    assertThat(allowed(auth(pin), "GET", "/api/clients/3")).isFalse();
    assertThat(allowed(auth(pin), "GET", "/api/clients/3/summary")).isFalse();
  }
}
