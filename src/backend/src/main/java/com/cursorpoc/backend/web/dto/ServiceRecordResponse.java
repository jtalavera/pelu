package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record ServiceRecordResponse(
    Long id,
    Long clientId,
    String clientFullName,
    String clientRuc,
    String status,
    BigDecimal totalAmount,
    BigDecimal tipsTotal,
    String voidReason,
    Instant createdAt,
    Instant closedAt,
    Long invoiceId,
    String invoiceNumberFormatted,
    List<ServiceRecordLineResponse> lines,
    List<ServiceRecordTipResponse> tips,
    /** The earliest turno this ficha belongs to, if any (id and start), shown on the ficha. */
    Long appointmentId,
    Instant appointmentStartAt,
    /** Every turno this ficha belongs to, earliest first (a ficha may serve several turnos). */
    List<ServiceRecordAppointmentResponse> appointments,
    /** The ficha belongs to the generic "cliente ocasional": the UI shows a translated label. */
    boolean clientGeneric) {}
