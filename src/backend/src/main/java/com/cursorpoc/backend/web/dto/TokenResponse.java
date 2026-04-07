package com.cursorpoc.backend.web.dto;

public record TokenResponse(String accessToken, long expiresInSeconds, String tokenType) {}
