package com.cursorpoc.backend.domain.enums;

/**
 * HU-37/HU-40: a tenant's platform-level lifecycle state. {@code SUSPENDED} blocks login for every
 * user of that tenant without deleting any of its data (HU-40's scope); every tenant is created
 * {@code ACTIVE} (HU-37 AC-4).
 */
public enum TenantStatus {
  ACTIVE,
  SUSPENDED
}
