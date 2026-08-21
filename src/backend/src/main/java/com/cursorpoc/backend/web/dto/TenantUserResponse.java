package com.cursorpoc.backend.web.dto;

/**
 * HU-42 AC-3: one row of the tenant's user listing — every {@code AppUser} tied to the tenant (both
 * {@code ADMIN} and {@code PROFESSIONAL} roles), so the Platform Admin can see all admins currently
 * assigned to it (and the professionals with login access) from the tenant's detail.
 */
public record TenantUserResponse(long userId, String email, String role, boolean enabled) {}
