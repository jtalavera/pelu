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
    int inactiveClientsThresholdDays,
    List<RevenueTrendPoint> revenueTrend,
    int revenueTrendDays) {

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

  /**
   * Issue #219 — "Dashboard: fundamentos de gráficos + tendencia de facturación". One calendar day
   * (business timezone) of the trailing {@code revenueTrendDays}-day window, ordered oldest first.
   * {@code date} is an ISO-8601 {@code yyyy-MM-dd} string (not an {@code Instant} — a chart x-axis
   * has no use for a time-of-day component here). {@code invoiced} is {@code ZERO}, never omitted,
   * for a day with no {@code ISSUED} invoices, so every point in the series lines up on a
   * fixed-length, gap-free x-axis. This same shape (day-bucketed points over a fixed trailing
   * window, one numeric field per series) is the pattern later dashboard charts (issues #220-#223)
   * are expected to reuse.
   */
  public record RevenueTrendPoint(String date, BigDecimal invoiced) {}
}
