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
    List<PaymentMethodMix> paymentMethodMix,
    List<AppointmentsByDayOfWeek> appointmentsByDayOfWeek) {

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

  /**
   * Issue #222 — "Dashboard: gráfico de turnos por día de semana". Appointment counts bucketed by
   * day of week (business timezone), over the same trailing {@code revenueTrendDays}-day window as
   * {@link #revenueTrend}/{@link #topServices}/{@link #paymentMethodMix} (no separate "days" field,
   * same reasoning as those). Counts the same statuses as {@code
   * AppointmentRepository#countDistinctClientsWithAppointmentsBetween} — {@code PENDING}, {@code
   * CONFIRMED}, {@code IN_PROGRESS}, {@code COMPLETED} — excluding {@code CANCELLED}/{@code
   * NO_SHOW}, since those slots didn't represent actual salon activity. This is a deliberate
   * deviation from {@code appointmentsToday.total} (which counts every status, including {@code
   * CANCELLED}, since it answers "how many slots were booked today" rather than "how much did we
   * actually work"). {@code dayOfWeek} is always one of {@code "mon".."sun"} (matching the {@code
   * femme.calendar.days.*}/{@code femme.professionals.days.*} i18n keys already used elsewhere for
   * weekday labels, so the frontend doesn't need a duplicate mapping) — always exactly 7 entries,
   * Monday first, zero-filled for a day with no countable appointments (gap-free, same as {@link
   * #revenueTrend}).
   */
  public record AppointmentsByDayOfWeek(String dayOfWeek, long count) {}
}
