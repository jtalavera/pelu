package com.cursorpoc.backend.domain.enums;

/**
 * HU-47 (Épica D — Tiers y Feature Flags): which of the 3 resolution levels produced a tenant's
 * currently-effective value for a feature flag, from lowest to highest precedence: {@code GLOBAL}
 * (the flag's platform-wide default, {@code FeatureFlag#enabled}), {@code TIER} (the tenant's
 * assigned tier defines this flag in its default package, {@code TierFeatureFlag}, HU-46), and
 * {@code OVERRIDE} (a tenant-specific override, {@code TenantFeatureFlag}, pre-existing HU-49
 * mechanism). Surfaced to the Platform Admin feature-flags screen (AC-4) so it's explicit where the
 * effective value comes from.
 */
public enum FeatureFlagSource {
  GLOBAL,
  TIER,
  OVERRIDE
}
