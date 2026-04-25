package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotNull;

public record FeatureGlobalUpdateRequest(@NotNull Boolean enabled, String description) {}
