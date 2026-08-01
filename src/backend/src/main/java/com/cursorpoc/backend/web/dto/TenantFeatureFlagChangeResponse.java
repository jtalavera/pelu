package com.cursorpoc.backend.web.dto;

import java.time.Instant;

/** SIFEN HU-22 AC-05: fecha, hora, usuario, valor anterior y nuevo of the last flag change. */
public record TenantFeatureFlagChangeResponse(
    Instant changedAt, String changedByEmail, boolean previousEnabled, boolean newEnabled) {}
