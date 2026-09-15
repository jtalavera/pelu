package com.cursorpoc.backend.web.dto;

import java.time.Instant;

/** Issue #205 AC-2: one row of an invoice's SIFEN interaction history. */
public record SifenInvoiceEventLogResponse(
    String eventType, Instant occurredAt, String resultCode, String message) {}
