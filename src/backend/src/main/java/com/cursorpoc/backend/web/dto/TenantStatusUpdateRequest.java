package com.cursorpoc.backend.web.dto;

/**
 * HU-40 AC-1/AC-4: {@code status} must be one of {@link
 * com.cursorpoc.backend.domain.enums.TenantStatus} ("ACTIVE" or "SUSPENDED").
 */
public record TenantStatusUpdateRequest(String status) {}
