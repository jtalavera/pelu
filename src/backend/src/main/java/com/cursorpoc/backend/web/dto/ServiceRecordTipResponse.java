package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;

public record ServiceRecordTipResponse(
    Long professionalId, String professionalName, BigDecimal amount) {}
