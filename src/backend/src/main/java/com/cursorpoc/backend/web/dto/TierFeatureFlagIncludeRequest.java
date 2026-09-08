package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotNull;

/** HU-46 AC-1/AC-2: whether the flag should be included in the tier's default package. */
public record TierFeatureFlagIncludeRequest(@NotNull Boolean included) {}
