package com.cursorpoc.backend.web.dto;

import java.time.Instant;

/**
 * HU-40 AC-1/AC-4: fecha, hora, usuario, estado anterior y nuevo of a tenant's last status change.
 */
public record TenantStatusChangeResponse(
    Instant changedAt, String changedByEmail, String previousStatus, String newStatus) {}
