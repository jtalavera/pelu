package com.cursorpoc.backend.web.dto;

/**
 * Platform Admin sets a tenant's skin. {@code skin} must be one of the {@code TenantSkin} names;
 * anything else (including blank) is rejected with {@code TENANT_SKIN_INVALID} by the service.
 */
public record TenantSkinUpdateRequest(String skin) {}
