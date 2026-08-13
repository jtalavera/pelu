package com.cursorpoc.backend.domain.enums;

/**
 * RT-19 (Hardening_SIFEN.md): whether a tenant has completed SIFEN homologación (the SET pilot
 * process) before {@code SIFEN_ELECTRONIC_INVOICING} is turned on for them in production.
 * Informative for the {@code SYSTEM_ADMIN} who decides — deliberately not a hard gate on the flag
 * itself, since a real tenant may legitimately need the flag on in the TEST SIFEN environment
 * before homologación is complete.
 */
public enum SifenHomologationStatus {
  PENDING,
  APPROVED
}
