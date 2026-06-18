package com.cursorpoc.backend.web.dto;

/** Request body for PUT /api/me/profile. */
public record MeProfileUpdateRequest(
    String fullName, String phone, String email, String address, String photoDataUrl) {}
