package com.cursorpoc.backend.web.dto;

public record MeResponse(
    long userId,
    long tenantId,
    String email,
    String role,
    Long professionalId,
    /** When role is {@code SYSTEM_ADMIN}, the salon tenant to preview (flags, UI). */
    Long previewTenantId) {}
