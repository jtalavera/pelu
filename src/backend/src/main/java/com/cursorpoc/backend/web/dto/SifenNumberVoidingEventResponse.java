package com.cursorpoc.backend.web.dto;

import java.time.Instant;
import java.time.LocalDate;

/**
 * RT-25 (Hardening_SIFEN.md). {@code supersededByApproved} (Issue #205 AC-4): true when this
 * still-{@code PENDING}/{@code REJECTED} event's range is already fully covered by a separate,
 * approved voiding event — it has nothing left to resolve even though its own status looks
 * actionable.
 */
public record SifenNumberVoidingEventResponse(
    Long id,
    String documentType,
    int rangeFrom,
    int rangeTo,
    String reason,
    String status,
    LocalDate deadlineDate,
    Instant createdAt,
    Instant submittedAt,
    String resultCode,
    String message,
    String protocolNumber,
    Long invoiceId,
    boolean supersededByApproved) {}
