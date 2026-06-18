package com.cursorpoc.backend.web.dto;

/**
 * Profile data for the logged-in user. Populated from the linked Professional when the user has
 * role PROFESSIONAL; null for admin users who have no linked Professional.
 */
public record MeProfileResponse(
    String fullName, String phone, String email, String address, String photoDataUrl) {}
