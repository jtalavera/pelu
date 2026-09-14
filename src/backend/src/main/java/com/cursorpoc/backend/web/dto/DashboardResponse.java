package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;
import java.util.List;

public record DashboardResponse(
    AppointmentSummary appointmentsToday,
    RevenueSummary revenueDay,
    RevenueSummary revenueWeek,
    long clientsThisMonth,
    List<FiscalAlert> fiscalAlerts,
    List<InactiveClient> inactiveClients,
    int inactiveClientsThresholdDays) {

  public record AppointmentSummary(
      long total, long pending, long confirmed, long inProgress, long completed) {}

  public record RevenueSummary(BigDecimal invoiced, BigDecimal collected) {}

  public record FiscalAlert(String severity, String messageKey, String message) {}

  /**
   * Issue #216 — "Panel de clientes inactivos". {@code daysSinceLastVisit} is {@code null} when the
   * client never had a {@code COMPLETED} appointment; {@code lastVisitAt} mirrors that (also {@code
   * null}).
   */
  public record InactiveClient(
      long clientId, String fullName, String phone, Long daysSinceLastVisit, String lastVisitAt) {}
}
