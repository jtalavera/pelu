package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;

public record TipReportProfessionalTotalResponse(
    Long professionalId, String professionalName, BigDecimal total) {}
