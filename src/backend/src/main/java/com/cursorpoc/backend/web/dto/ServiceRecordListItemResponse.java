package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;
import java.time.Instant;

public record ServiceRecordListItemResponse(
    Long id,
    Long clientId,
    String clientFullName,
    String status,
    BigDecimal totalAmount,
    Instant createdAt,
    /** Distinct service names on the record, in line order, comma-separated (list subtitle). */
    String servicesSummary,
    /** Distinct professional names on the record, in line order, comma-separated. */
    String professionalsSummary,
    /** The earliest turno this ficha belongs to, if any. */
    Long appointmentId,
    Instant appointmentStartAt,
    /** The ficha belongs to the generic "cliente ocasional": the UI shows a translated label. */
    boolean clientGeneric) {}
