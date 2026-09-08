package com.cursorpoc.backend.web.dto;

/**
 * HU-46 AC-1: one row of a tier's feature-flag matrix — the global flag catalog entry plus whether
 * this tier includes it in its default package.
 *
 * @param included whether this flag is part of the tier's default package
 * @param lastChange HU-46 AC-5: the last time this tier's inclusion of this flag changed, if ever
 */
public record TierFeatureFlagRowResponse(
    String flagKey,
    String description,
    boolean globalEnabled,
    boolean included,
    TierFeatureFlagChangeResponse lastChange) {}
