package com.cursorpoc.backend.web.dto;

import com.cursorpoc.backend.domain.enums.SifenHomologationStatus;
import java.time.Instant;

/**
 * RT-19 (Hardening_SIFEN.md). {@code markedByEmail}/{@code markedAt} are null when no Platform
 * Admin has ever explicitly recorded this tenant's homologación state — {@code status} is still
 * {@code PENDING} in that case, it just has no marker yet.
 */
public record TenantSifenHomologationResponse(
    SifenHomologationStatus status, String markedByEmail, Instant markedAt) {}
