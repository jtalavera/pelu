package com.cursorpoc.backend.web.dto;

import java.time.Instant;
import java.time.LocalDate;

/** RT-25 (Hardening_SIFEN.md). */
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
    Long invoiceId) {}
