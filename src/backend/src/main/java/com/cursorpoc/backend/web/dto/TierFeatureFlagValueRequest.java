package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotNull;

/**
 * HU-46 AC-1/AC-2: this tier's value (ON/OFF) for a flag. OFF restricts it for the tier's tenants.
 */
public record TierFeatureFlagValueRequest(@NotNull Boolean enabled) {}
