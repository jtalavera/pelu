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
   * Issue #216 — "Panel de clientes inactivos". Only clients with at least one {@code COMPLETED}
   * appointment can appear here (issue #216 follow-up: never having visited excludes a client
   * entirely, it isn't "inactive") — {@code daysSinceLastVisit}/{@code lastVisitAt} are always
   * present.
   */
  public record InactiveClient(
      long clientId, String fullName, String phone, long daysSinceLastVisit, String lastVisitAt) {}
}
