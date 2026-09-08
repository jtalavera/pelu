package com.cursorpoc.backend.web.dto;

/**
 * HU-34 AC-3/AC-5: identity payload for the {@code PLATFORM_ADMIN} area — deliberately has no
 * {@code tenantId} field, unlike {@link MeResponse}. Platform routes never carry tenant context.
 */
public record PlatformMeResponse(long userId, String email, String role) {}
