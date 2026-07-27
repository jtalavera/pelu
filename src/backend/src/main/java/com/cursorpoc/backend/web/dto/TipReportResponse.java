package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;
import java.util.List;

public record TipReportResponse(
    List<TipReportRowResponse> rows,
    List<TipReportProfessionalTotalResponse> professionalTotals,
    BigDecimal grandTotal) {}
