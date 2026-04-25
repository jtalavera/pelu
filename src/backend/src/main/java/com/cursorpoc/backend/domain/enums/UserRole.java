package com.cursorpoc.backend.domain.enums;

public enum UserRole {
  /** Platform operator; may access any tenant in admin APIs and impersonate via preview context. */
  SYSTEM_ADMIN,
  /** Tenant (salon) administrator. */
  ADMIN,
  PROFESSIONAL
}
