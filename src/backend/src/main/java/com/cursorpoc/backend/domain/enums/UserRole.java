package com.cursorpoc.backend.domain.enums;

public enum UserRole {
  /** Platform operator; may access any tenant in admin APIs and impersonate via preview context. */
  SYSTEM_ADMIN,
  /** Tenant (salon) administrator. */
  ADMIN,
  PROFESSIONAL,
  /**
   * HU-34: genuinely tenant-independent platform operator. Unlike {@link #SYSTEM_ADMIN} (still
   * pinned to a tenant row via FK for legacy reasons), a {@code PLATFORM_ADMIN} {@link
   * com.cursorpoc.backend.domain.AppUser} has {@code tenant == null} and its JWT never carries a
   * {@code tid} claim. It only accesses the platform via explicit {@code /api/platform/**} routes —
   * never via a bypass on tenant-scoped routes. HU-36 migrates the legacy {@code SYSTEM_ADMIN} to
   * this role; not done here.
   */
  PLATFORM_ADMIN
}
