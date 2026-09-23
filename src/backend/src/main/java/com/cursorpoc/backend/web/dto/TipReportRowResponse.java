package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;
import java.time.Instant;

public record TipReportRowResponse(
    Long professionalId,
    String professionalName,
    BigDecimal amount,
    String clientName,
    Instant serviceDateTime) {}
