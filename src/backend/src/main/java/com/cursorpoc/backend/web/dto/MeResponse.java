package com.cursorpoc.backend.web.dto;

public record MeResponse(
    long userId,
    /** Null only for {@code PLATFORM_ADMIN} (HU-35) — genuinely tenant-independent. */
    Long tenantId,
    String email,
    String role,
    Long professionalId,
    /** When role is {@code SYSTEM_ADMIN}, the salon tenant to preview (flags, UI). */
    Long previewTenantId,
    /**
     * Profile data from the linked Professional; null for admin users without a linked
     * Professional.
     */
    MeProfileResponse profile) {}
