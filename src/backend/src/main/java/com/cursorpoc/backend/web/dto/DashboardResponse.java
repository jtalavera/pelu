package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;
import java.util.List;

public record DashboardResponse(
    AppointmentSummary appointmentsToday,
    RevenueSummary revenueDay,
    RevenueSummary revenueWeek,
    List<FiscalAlert> fiscalAlerts) {

  public record AppointmentSummary(
      long total, long pending, long confirmed, long inProgress, long completed) {}

  public record RevenueSummary(BigDecimal invoiced, BigDecimal collected) {}

  public record FiscalAlert(String severity, String messageKey, String message) {}
}
