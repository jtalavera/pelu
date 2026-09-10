package com.cursorpoc.backend.web.dto;

/**
 * Admin view: global default, the tenant's tier value (if the tier defines it, HU-46/HU-47), and
 * the tenant's own value for one flag.
 *
 * @param hasTier whether the tenant's assigned tier defines this flag
 * @param tierEnabled when {@code hasTier} is true, the tier's value for this flag; otherwise null
 *     (a missing tier row means "inherit", i.e. ON)
 * @param overrideEnabled when {@code hasOverride} is true, the tenant's value; otherwise null (a
 *     missing tenant row means "inherit", i.e. ON)
 * @param effectiveEnabled the resolved value per HU-47: {@code global AND tier AND tenant} — the
 *     flag is ON only when every applicable level is ON
 * @param lastChange SIFEN HU-22 AC-05: the last time this tenant's value for this flag changed, if
 *     ever
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
    TenantFeatureFlagChangeResponse lastChange) {}
