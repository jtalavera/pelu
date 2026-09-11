package com.cursorpoc.backend.web.dto;

/**
 * HU-45 AC-4: one row of the Platform Admin's tier listing — includes {@code tenantCount} so the
 * Platform Admin can see, at a glance, how many tenants have each tier assigned (also used to
 * explain a blocked deletion, AC-3).
 */
public record TierResponse(Long id, String name, String description, long tenantCount) {}
