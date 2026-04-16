package com.cursorpoc.backend.web.dto;

public record GrantAccessResponse(boolean emailSent, String rawToken) {}
