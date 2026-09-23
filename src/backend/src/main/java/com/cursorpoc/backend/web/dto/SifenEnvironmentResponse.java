package com.cursorpoc.backend.web.dto;

/**
 * Which SIFEN environment the backend's connection is configured against ({@code TEST} or {@code
 * PRODUCTION}). Read-only; lets the frontend decide, for example, whether to offer the
 * "production-style" sample KuDE download (only meaningful in {@code TEST}).
 */
public record SifenEnvironmentResponse(String environment) {}
