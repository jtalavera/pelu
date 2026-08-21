package com.cursorpoc.backend.web.dto;

/**
 * HU-41: {@code professionalId}/{@code professionalName} are {@code null} when the token belongs to
 * a Platform-Admin-invited tenant {@code ADMIN} user rather than a {@code Professional} — {@code
 * ActivatePage} falls back to its generic subtitle in that case.
 */
public record ActivationTokenInfoResponse(
    Long professionalId, String professionalName, String email) {}
