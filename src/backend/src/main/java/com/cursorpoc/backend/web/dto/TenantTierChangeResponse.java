package com.cursorpoc.backend.web.dto;

import java.time.Instant;

/** HU-38 AC-6: fecha, hora, usuario, tier anterior y nuevo of a tenant's last tier change. */
public record TenantTierChangeResponse(
    Instant changedAt, String changedByEmail, String previousTierName, String newTierName) {}
