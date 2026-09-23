package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.SifenConnectionProperties;
import com.cursorpoc.backend.config.SifenConnectionProperties.Environment;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class DuplicateClientEmailPolicyTest {

  private static final long TENANT_ID = 1L;

  @Mock private FeatureFlagService featureFlagService;

  private DuplicateClientEmailPolicy policyFor(Environment environment) {
    SifenConnectionProperties connectionProperties = new SifenConnectionProperties();
    connectionProperties.setEnvironment(environment);
    return new DuplicateClientEmailPolicy(featureFlagService, connectionProperties);
  }

  @Test
  void testEnvironment_flagEnabled_liftsUniqueness() {
    when(featureFlagService.isEnabled(eq("ALLOW_DUPLICATE_CLIENT_EMAIL"), eq(TENANT_ID)))
        .thenReturn(true);

    assertThat(policyFor(Environment.TEST).isUniquenessEnforced(TENANT_ID)).isFalse();
  }

  @Test
  void testEnvironment_flagDisabled_enforcesUniqueness() {
    when(featureFlagService.isEnabled(eq("ALLOW_DUPLICATE_CLIENT_EMAIL"), eq(TENANT_ID)))
        .thenReturn(false);

    assertThat(policyFor(Environment.TEST).isUniquenessEnforced(TENANT_ID)).isTrue();
  }

  @Test
  void productionEnvironment_flagEnabled_stillEnforcesUniqueness_andNeverChecksFlag() {
    lenient()
        .when(featureFlagService.isEnabled(eq("ALLOW_DUPLICATE_CLIENT_EMAIL"), anyLong()))
        .thenReturn(true);

    assertThat(policyFor(Environment.PRODUCTION).isUniquenessEnforced(TENANT_ID)).isTrue();
    // The environment check short-circuits, so the flag is never consulted in production.
    verifyNoInteractions(featureFlagService);
  }

  @Test
  void productionEnvironment_flagDisabled_enforcesUniqueness() {
    assertThat(policyFor(Environment.PRODUCTION).isUniquenessEnforced(TENANT_ID)).isTrue();
    verifyNoInteractions(featureFlagService);
  }

  @Test
  void flagKey_matchesFeatureFlagServiceKeyFormat() {
    assertThat(DuplicateClientEmailPolicy.FLAG_KEY).isEqualTo("ALLOW_DUPLICATE_CLIENT_EMAIL");
    assertThat(Pattern.matches("^[A-Z0-9_]{1,100}$", DuplicateClientEmailPolicy.FLAG_KEY)).isTrue();
  }
}
