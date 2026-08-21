package com.cursorpoc.backend.web.dto;

import com.cursorpoc.backend.domain.enums.FeatureFlagSource;

/**
 * Admin view: global default, the tenant's tier default (if any, HU-46/HU-47), and optional tenant
 * override for one flag.
 *
 * @param hasTier whether the tenant's assigned tier (if any) defines this flag in its default
 *     package
 * @param tierEnabled when {@code hasTier} is true, the tier's value for this flag; otherwise null
 * @param overrideEnabled when {@code hasOverride} is true, the tenant's forced value; otherwise
 *     null
 * @param effectiveEnabled the resolved value per HU-47's 3-level precedence (override > tier >
 *     global)
 * @param effectiveSource HU-47 AC-4: which of the 3 levels produced {@code effectiveEnabled}
 * @param lastChange SIFEN HU-22 AC-05: the last time this tenant's override for this flag changed,
 *     if ever
 */
public record TenantFeatureFlagRowResponse(
    String flagKey,
    String description,
    boolean globalEnabled,
    boolean hasTier,
    Boolean tierEnabled,
    boolean hasOverride,
    Boolean overrideEnabled,
    boolean effectiveEnabled,
    FeatureFlagSource effectiveSource,
    TenantFeatureFlagChangeResponse lastChange) {}
