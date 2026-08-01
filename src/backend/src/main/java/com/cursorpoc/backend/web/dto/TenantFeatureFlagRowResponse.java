package com.cursorpoc.backend.web.dto;

/**
 * Admin view: global default plus optional tenant override for one flag.
 *
 * @param overrideEnabled when {@code hasOverride} is true, the tenant's forced value; otherwise
 *     null
 * @param lastChange SIFEN HU-22 AC-05: the last time this tenant's override for this flag changed,
 *     if ever
 */
public record TenantFeatureFlagRowResponse(
    String flagKey,
    String description,
    boolean globalEnabled,
    boolean hasOverride,
    Boolean overrideEnabled,
    TenantFeatureFlagChangeResponse lastChange) {}
