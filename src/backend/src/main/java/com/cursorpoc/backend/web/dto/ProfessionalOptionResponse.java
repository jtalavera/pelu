package com.cursorpoc.backend.web.dto;

/**
 * The few fields a professional picker needs (no photo, schedules, access or contact data), so the
 * list stays tiny and cheap to build.
 */
public record ProfessionalOptionResponse(
    long id, String fullName, String nickname, String displayName, boolean active) {}
