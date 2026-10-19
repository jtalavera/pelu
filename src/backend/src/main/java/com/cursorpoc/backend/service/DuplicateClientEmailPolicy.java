package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.SifenConnectionProperties;
import org.springframework.stereotype.Component;

/**
 * Decides whether the per-tenant "a client email must be unique" rule still applies.
 *
 * <p>SIFEN electronic-invoicing testing needs to reuse the same recipient email across many test
 * clients. When the tenant has the {@code ALLOW_DUPLICATE_CLIENT_EMAIL} feature flag enabled AND
 * the app is pointed at the SIFEN <b>TEST</b> environment ({@code
 * app.femme.sifen.connection.environment=TEST}), the uniqueness check on {@code Client.email} is
 * skipped in {@link ClientService} and {@link InvoiceService}. Production ({@code environment=
 * PRODUCTION}) always enforces uniqueness, regardless of the flag.
 *
 * <p>Deliberately scoped to the email check only; phone and RUC uniqueness are unaffected.
 * Extending to RUC later is a one-line change per call-site (or a second flag via a parallel
 * helper).
 */
@Component
public class DuplicateClientEmailPolicy {

  static final String FLAG_KEY = "ALLOW_DUPLICATE_CLIENT_EMAIL";

  private final FeatureFlagService featureFlagService;
  private final SifenConnectionProperties sifenConnectionProperties;

  public DuplicateClientEmailPolicy(
      FeatureFlagService featureFlagService, SifenConnectionProperties sifenConnectionProperties) {
    this.featureFlagService = featureFlagService;
    this.sifenConnectionProperties = sifenConnectionProperties;
  }

  /**
   * @return {@code true} when the caller must still reject a duplicate client email for this tenant
   *     (the normal case), {@code false} only in the SIFEN TEST environment with the flag enabled.
   */
  public boolean isUniquenessEnforced(long tenantId) {
    return !duplicatesAllowed(tenantId);
  }

  private boolean duplicatesAllowed(long tenantId) {
    return sifenConnectionProperties.activeEnvironment()
            == SifenConnectionProperties.Environment.TEST
        && featureFlagService.isEnabled(FLAG_KEY, tenantId);
  }
}
