package com.cursorpoc.backend.domain.enums;

public enum UserRole {
  /** Tenant (salon) administrator. */
  ADMIN,
  PROFESSIONAL,
  /**
   * HU-34: genuinely tenant-independent platform operator. A {@code PLATFORM_ADMIN} {@link
   * com.cursorpoc.backend.domain.AppUser} has {@code tenant == null} and its JWT never carries a
   * {@code tid} claim. It only accesses the platform via explicit {@code /api/platform/**} (and,
   * since HU-36, {@code /api/admin/feature-flags/**}) routes — never via a bypass on tenant-scoped
   * routes. HU-36 migrated the legacy {@code SYSTEM_ADMIN} role (tenant-bound via FK, see former
   * V10 migration) to this role and retired {@code SYSTEM_ADMIN} from the enum entirely: no
   * historical data or code needs the old value once the V40 migration has run.
   */
  PLATFORM_ADMIN
}
