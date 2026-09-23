package com.cursorpoc.backend.web.dto;

/**
 * HU-38 AC-2: "mismas validaciones que el alta" — name required, domain optional but unique
 * platform-wide (excluding the tenant being edited), tier required and must reference an existing
 * {@link com.cursorpoc.backend.domain.Tier}. Same shape as {@link TenantCreateRequest}, kept as a
 * separate record so each endpoint's contract can evolve independently.
 */
public record TenantUpdateRequest(String name, String domain, Long tierId) {}
