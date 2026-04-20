package com.cursorpoc.backend.web.dto;

public record MeResponse(
    long userId, long tenantId, String email, String role, Long professionalId) {}
