package com.cursorpoc.backend.web.dto;

/**
 * HU-46 AC-1: one row of a tier's feature-flag matrix — the global flag catalog entry plus this
 * tier's value for it and the resulting effective value at the tier level.
 *
 * @param globalEnabled the flag's global default
 * @param tierEnabled this tier's value for the flag (ON when the tier has no row for it)
 * @param effectiveEnabled {@code globalEnabled AND tierEnabled} — what a tenant on this tier gets
 *     before its own value is applied (HU-47)
 * @param lastChange HU-46 AC-5: the last time this tier's value for this flag changed, if ever
 */
public record TierFeatureFlagRowResponse(
    String flagKey,
    String description,
    boolean globalEnabled,
    boolean tierEnabled,
    boolean effectiveEnabled,
    TierFeatureFlagChangeResponse lastChange) {}
