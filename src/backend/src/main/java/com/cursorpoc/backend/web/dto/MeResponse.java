package com.cursorpoc.backend.web.dto;

public record MeResponse(
    long userId,
    /** Null only for {@code PLATFORM_ADMIN} (HU-35) — genuinely tenant-independent. */
    Long tenantId,
    /** Same null-only-for-{@code PLATFORM_ADMIN} rule as {@link #tenantId}. */
    String tenantName,
    String email,
    /**
     * HU-41 follow-up: the user's human name — an invited ADMIN's self-set full name, or a
     * professional's {@code Professional#fullName}. Null for users who never set one (the platform
     * admin, admins invited before this field existed); the frontend falls back to the email
     * local-part.
     */
    String fullName,
    String role,
    Long professionalId,
    /**
     * Profile data from the linked Professional; null for admin users without a linked
     * Professional.
     */
    MeProfileResponse profile) {}
