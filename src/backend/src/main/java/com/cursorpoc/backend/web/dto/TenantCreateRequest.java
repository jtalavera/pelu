package com.cursorpoc.backend.web.dto;

/**
 * HU-37 AC-1: name is required, domain is optional but unique platform-wide, tier is required and
 * must reference an existing {@code Tier} (HU-45). Validated in {@code TenantAdminService}, not via
 * bean-validation annotations here, so each failure can carry its own SCREAMING_SNAKE_CASE error
 * code (see {@code femme.apiErrors.*}) instead of a generic {@code INVALID_REQUEST}.
 */
public record TenantCreateRequest(String name, String domain, Long tierId) {}
