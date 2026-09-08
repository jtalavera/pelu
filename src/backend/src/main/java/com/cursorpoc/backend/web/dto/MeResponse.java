package com.cursorpoc.backend.web.dto;

public record MeResponse(
    long userId,
    /** Null only for {@code PLATFORM_ADMIN} (HU-35) — genuinely tenant-independent. */
    Long tenantId,
    /** Same null-only-for-{@code PLATFORM_ADMIN} rule as {@link #tenantId}. */
    String tenantName,
    String email,
    String role,
    Long professionalId,
    /**
     * Profile data from the linked Professional; null for admin users without a linked
     * Professional.
     */
    MeProfileResponse profile) {}
