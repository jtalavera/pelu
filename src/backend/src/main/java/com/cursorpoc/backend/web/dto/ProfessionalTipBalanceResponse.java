package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;

public record ProfessionalTipBalanceResponse(
    Long professionalId, String professionalName, BigDecimal balance) {}
