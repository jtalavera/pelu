package com.cursorpoc.backend.web.dto;

import java.time.Instant;

/** HU-46 AC-5: fecha, hora, usuario, valor anterior y nuevo of the last tier<->flag change. */
public record TierFeatureFlagChangeResponse(
    Instant changedAt, String changedByEmail, boolean previousIncluded, boolean newIncluded) {}
