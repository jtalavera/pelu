package com.cursorpoc.backend.security;

import com.cursorpoc.backend.domain.enums.UserRole;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.function.Supplier;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.authorization.AuthorizationResult;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.access.intercept.RequestAuthorizationContext;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcher;

/**
 * HU-24 AC-11/12/13 + issue #38: deny-by-default for the {@code PROFESSIONAL} role. A logged-in
 * professional may only reach the endpoints the calendar, her own profile and her own commissions
 * need; every other authenticated route (cash, invoices, dashboards, tips, settings, clients
 * management, services management, Stock, …) answers 403 regardless of what the SPA shows.
 *
 * <p>Row-level rules (a professional only edits her own appointments) live in the controllers; this
 * policy only decides which routes are reachable at all. Any other role keeps the plain
 * "authenticated" rule — admin-only checks inside controllers still apply.
 */
public final class ProfessionalAccessPolicy
    implements AuthorizationManager<RequestAuthorizationContext> {

  private static final PathPatternRequestMatcher.Builder PATHS =
      PathPatternRequestMatcher.withDefaults();

  static final List<RequestMatcher> PROFESSIONAL_ALLOWED =
      List.of(
          // Own session / profile / guided tour.
          PATHS.matcher(HttpMethod.GET, "/api/me"),
          PATHS.matcher(HttpMethod.PUT, "/api/me/profile"),
          PATHS.matcher(HttpMethod.POST, "/api/me/change-password"),
          PATHS.matcher("/api/me/tour-state/**"),
          PATHS.matcher(HttpMethod.GET, "/api/feature-flags"),
          // Calendar: see every appointment, create/edit only her own (checked in the controller).
          PATHS.matcher(HttpMethod.GET, "/api/appointments"),
          PATHS.matcher(HttpMethod.GET, "/api/appointments/{id:\\d+}"),
          PATHS.matcher(HttpMethod.POST, "/api/appointments"),
          PATHS.matcher(HttpMethod.PUT, "/api/appointments/{id:\\d+}"),
          PATHS.matcher(HttpMethod.PATCH, "/api/appointments/{id:\\d+}/status"),
          // Read-only catalogs the appointment form and the professional filter need.
          PATHS.matcher(HttpMethod.GET, "/api/professionals"),
          PATHS.matcher(HttpMethod.GET, "/api/services"),
          PATHS.matcher(HttpMethod.GET, "/api/clients"),
          // HU-COM-07: own commissions (CommissionAccess still enforces own-data-only).
          PATHS.matcher(HttpMethod.GET, "/api/commissions/me"),
          PATHS.matcher(HttpMethod.GET, "/api/commissions/me/settlements/{id:\\d+}"));

  @Override
  public AuthorizationResult authorize(
      Supplier<? extends Authentication> authentication, RequestAuthorizationContext context) {
    Authentication auth = authentication.get();
    if (auth == null || !auth.isAuthenticated() || auth instanceof AnonymousAuthenticationToken) {
      return new AuthorizationDecision(false);
    }
    // Integration principals (Stock technical user) and every non-professional role keep the
    // plain "authenticated" rule.
    if (auth.getPrincipal() instanceof FemmeUserPrincipal principal
        && principal.getRole() == UserRole.PROFESSIONAL) {
      return new AuthorizationDecision(isAllowedForProfessional(context.getRequest()));
    }
    return new AuthorizationDecision(true);
  }

  static boolean isAllowedForProfessional(HttpServletRequest request) {
    for (RequestMatcher matcher : PROFESSIONAL_ALLOWED) {
      if (matcher.matches(request)) {
        return true;
      }
    }
    return false;
  }
}
