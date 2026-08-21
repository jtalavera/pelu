package com.cursorpoc.backend.web.dto;

/**
 * HU-44 AC-1/AC-2/AC-3/AC-4: confirms a "resend" action for a single tenant user — either a fresh
 * activation invite ({@code passwordReset == false}, user never activated) or a password-reset
 * trigger ({@code passwordReset == true}, user already activated but lost access), mutually
 * exclusive based on the user's current activation state (AC-1/AC-2). Either branch invalidates any
 * previously issued unused link for this user before issuing the new one (AC-3). {@code rawToken}
 * is exposed only so Playwright e2e coverage can exercise the full activate/reset-password flow
 * without depending on reading the (dev-logged in e2e) email body — the Platform Admin themselves
 * never sees or sets a password (AC-5).
 */
public record ResendInvitationResponse(
    long userId, String email, boolean passwordReset, String rawToken) {}
