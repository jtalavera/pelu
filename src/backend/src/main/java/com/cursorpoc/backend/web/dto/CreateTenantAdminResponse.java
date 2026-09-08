package com.cursorpoc.backend.web.dto;

/**
 * HU-41 AC-6: confirms the invitation was sent. {@code rawToken} is returned only as an API-level
 * test/automation aid (same convention as {@link GrantAccessResponse}) — the frontend never shows
 * it, and it is not a substitute for the emailed activation link.
 */
public record CreateTenantAdminResponse(
    long userId, String email, boolean invitationSent, String rawToken) {}
