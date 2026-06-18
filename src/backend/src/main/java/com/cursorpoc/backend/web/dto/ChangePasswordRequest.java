package com.cursorpoc.backend.web.dto;

/** Request body for POST /api/me/change-password. */
public record ChangePasswordRequest(String newPassword) {}
