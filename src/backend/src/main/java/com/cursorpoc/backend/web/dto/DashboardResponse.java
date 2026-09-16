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
    int revenueTrendDays,
    List<TopService> topServices,
    List<PaymentMethodMix> paymentMethodMix) {

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

  /**
   * Issue #220 — "Dashboard: gráfico de servicios más vendidos". Top services by invoiced revenue
   * over the same trailing {@code revenueTrendDays}-day window as {@link #revenueTrend} (no
   * separate "days" field — both charts share the exact same window, see {@code
   * DashboardService#buildTopServices}), ordered by {@code revenue} descending, capped server-side
   * to {@code DashboardService#TOP_SERVICES_LIMIT}.
   */
  public record TopService(String serviceName, BigDecimal revenue) {}

  /**
   * Issue #221 — "Dashboard: gráfico de mezcla de medios de pago". Invoiced revenue by {@code
   * PaymentMethod} over the same trailing {@code revenueTrendDays}-day window as {@link
   * #revenueTrend}/{@link #topServices} (no separate "days" field, same reasoning as {@link
   * TopService}), ordered by {@code amount} descending then method ascending, with no server-side
   * cap — every {@code PaymentMethod} value actually present in the window shows up, never a fixed
   * hardcoded subset. {@code method} is the enum's {@code name()} (e.g. {@code "DEBIT_CARD"}); the
   * frontend renders it through the same {@code femme.billing.invoice.paymentMethod*} i18n keys
   * already used for payment-method labels in the billing UI, rather than a duplicate mapping.
   */
  public record PaymentMethodMix(String method, BigDecimal amount) {}
}
