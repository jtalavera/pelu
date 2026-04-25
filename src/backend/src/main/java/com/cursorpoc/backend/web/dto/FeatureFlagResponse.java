package com.cursorpoc.backend.web.dto;

public record FeatureFlagResponse(String flagKey, boolean enabled, String description) {}
