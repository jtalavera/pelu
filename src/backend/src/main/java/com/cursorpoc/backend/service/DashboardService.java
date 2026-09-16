package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.FiscalStamp;
import com.cursorpoc.backend.domain.enums.AppointmentStatus;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.FiscalStampRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.web.dto.DashboardResponse;
import com.cursorpoc.backend.web.dto.PageResponse;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DashboardService {

  /**
   * Issue #216 — "Panel de clientes inactivos": an active client with at least one {@code
   * COMPLETED} appointment, whose most recent one is at least this many days in the past, is
   * considered inactive. Clients who never had a completed visit are not "inactive" — they're
   * excluded entirely (issue #216 follow-up). Kept as a single named constant rather than a literal
   * repeated in the query/filter/sort/i18n copy.
   */
  public static final int INACTIVE_CLIENT_THRESHOLD_DAYS = 90;

  /** Caps the dashboard widget to its top-N most-inactive clients; see "Ver todas" for the rest. */
  public static final int INACTIVE_CLIENTS_LIMIT = 10;

  /**
   * Issue #219 — "Dashboard: fundamentos de gráficos + tendencia de facturación": trailing window
   * (in days, including today) the revenue-trend chart covers. A single named constant, like {@link
   * #INACTIVE_CLIENT_THRESHOLD_DAYS}, rather than a literal repeated across the
   * query/bucketing/response — also the "N days (default 30)" parameter the source issue calls for,
   * kept as a server-side default instead of a query param so the single {@code GET /api/dashboard}
   * response shape (which sibling issues #220-#223 also extend) stays param-free.
   */
  public static final int REVENUE_TREND_DAYS = 30;

  /**
   * Issue #220 — "Dashboard: gráfico de servicios más vendidos": caps the top-services-by-revenue
   * chart, same single-named-constant pattern as {@link #INACTIVE_CLIENTS_LIMIT}. The AC calls for
   * "top 5-10 services by revenue" — 10 is the cap; a tenant with fewer distinct services simply
   * shows fewer bars.
   */
  public static final int TOP_SERVICES_LIMIT = 10;

  private final FemmeTimeProperties timeProperties;
  private final AppointmentRepository appointmentRepository;
  private final ClientRepository clientRepository;
  private final InvoiceRepository invoiceRepository;
  private final FiscalStampRepository fiscalStampRepository;
  private final BusinessProfileService businessProfileService;
  private final SifenNumberVoidingService sifenNumberVoidingService;

  public DashboardService(
      FemmeTimeProperties timeProperties,
      AppointmentRepository appointmentRepository,
      ClientRepository clientRepository,
      InvoiceRepository invoiceRepository,
      FiscalStampRepository fiscalStampRepository,
      BusinessProfileService businessProfileService,
      SifenNumberVoidingService sifenNumberVoidingService) {
    this.timeProperties = timeProperties;
    this.appointmentRepository = appointmentRepository;
    this.clientRepository = clientRepository;
    this.invoiceRepository = invoiceRepository;
    this.fiscalStampRepository = fiscalStampRepository;
    this.businessProfileService = businessProfileService;
    this.sifenNumberVoidingService = sifenNumberVoidingService;
  }

  @Transactional(readOnly = true)
  public DashboardResponse build(long tenantId) {
    var zone = timeProperties.zoneId();
    ZonedDateTime now = ZonedDateTime.now(zone);
    Instant dayStart = now.toLocalDate().atStartOfDay(zone).toInstant();
    Instant dayEnd = dayStart.plusSeconds(86400);

    ZonedDateTime weekStartZ =
        now.with(TemporalAdjusters.previousOrSame(java.time.DayOfWeek.MONDAY));
    Instant weekStart = weekStartZ.toLocalDate().atStartOfDay(zone).toInstant();
    Instant weekEnd = weekStart.plusSeconds(7L * 86400);

    LocalDate today = now.toLocalDate();
    LocalDate monthStartDate = today.withDayOfMonth(1);
    LocalDate monthEndExclusive = monthStartDate.plusMonths(1);
    Instant monthStart = monthStartDate.atStartOfDay(zone).toInstant();
    Instant monthEnd = monthEndExclusive.atStartOfDay(zone).toInstant();
    long clientsThisMonth =
        appointmentRepository.countDistinctClientsWithAppointmentsBetween(
            tenantId, monthStart, monthEnd);

    long total = appointmentRepository.countByTenantIdAndDay(tenantId, dayStart, dayEnd);
    long pending =
        appointmentRepository.countByTenant_IdAndStatusAndStartAtGreaterThanEqualAndStartAtLessThan(
            tenantId, AppointmentStatus.PENDING, dayStart, dayEnd);
    long confirmed =
        appointmentRepository.countByTenant_IdAndStatusAndStartAtGreaterThanEqualAndStartAtLessThan(
            tenantId, AppointmentStatus.CONFIRMED, dayStart, dayEnd);
    long inProgress =
        appointmentRepository.countByTenant_IdAndStatusAndStartAtGreaterThanEqualAndStartAtLessThan(
            tenantId, AppointmentStatus.IN_PROGRESS, dayStart, dayEnd);
    long completed =
        appointmentRepository.countByTenant_IdAndStatusAndStartAtGreaterThanEqualAndStartAtLessThan(
            tenantId, AppointmentStatus.COMPLETED, dayStart, dayEnd);

    BigDecimal invoicedDay =
        nz(
            invoiceRepository.sumTotalByTenantAndStatusAndIssuedBetween(
                tenantId, InvoiceStatus.ISSUED, dayStart, dayEnd));
    BigDecimal collectedDay =
        nz(
            invoiceRepository.sumPaymentsByTenantAndStatusAndIssuedBetween(
                tenantId, InvoiceStatus.ISSUED, dayStart, dayEnd));

    BigDecimal invoicedWeek =
        nz(
            invoiceRepository.sumTotalByTenantAndStatusAndIssuedBetween(
                tenantId, InvoiceStatus.ISSUED, weekStart, weekEnd));
    BigDecimal collectedWeek =
        nz(
            invoiceRepository.sumPaymentsByTenantAndStatusAndIssuedBetween(
                tenantId, InvoiceStatus.ISSUED, weekStart, weekEnd));

    List<DashboardResponse.FiscalAlert> alerts = new ArrayList<>();
    if (!businessProfileService.isRucReadyForInvoicing(tenantId)) {
      alerts.add(
          new DashboardResponse.FiscalAlert(
              "warning", "businessRucMissing", "Configure a valid business RUC to issue invoices"));
    }
    fiscalStampRepository
        .findByTenant_IdAndActiveTrue(tenantId)
        .ifPresentOrElse(
            stamp -> addFiscalAlerts(stamp, zone, alerts),
            () -> {
              if (businessProfileService.isRucReadyForInvoicing(tenantId)) {
                alerts.add(
                    new DashboardResponse.FiscalAlert(
                        "blocking",
                        "fiscalNoActiveStamp",
                        "No active fiscal stamp. Add and activate a stamp in Settings."));
              }
            });

    // RT-25: unreported "inutilización de numeración" events have a hard SIFEN deadline.
    sifenNumberVoidingService
        .pendingSummary(tenantId)
        .ifPresent(
            summary -> {
              if (summary.soonestDeadline().isBefore(today)) {
                alerts.add(
                    new DashboardResponse.FiscalAlert(
                        "warning",
                        "sifenVoidingOverdue",
                        "There are document-number voidings past their SIFEN deadline."));
              } else {
                alerts.add(
                    new DashboardResponse.FiscalAlert(
                        "warning",
                        "sifenVoidingPending",
                        "You have document-number voidings pending submission to SIFEN."));
              }
            });

    List<DashboardResponse.InactiveClient> inactiveClients =
        buildInactiveClients(tenantId, zone, today);

    List<DashboardResponse.RevenueTrendPoint> revenueTrend =
        buildRevenueTrend(tenantId, zone, today);

    List<DashboardResponse.TopService> topServices = buildTopServices(tenantId, zone, today);

    return new DashboardResponse(
        new DashboardResponse.AppointmentSummary(total, pending, confirmed, inProgress, completed),
        new DashboardResponse.RevenueSummary(invoicedDay, collectedDay),
        new DashboardResponse.RevenueSummary(invoicedWeek, collectedWeek),
        clientsThisMonth,
        alerts,
        inactiveClients,
        INACTIVE_CLIENT_THRESHOLD_DAYS,
        revenueTrend,
        REVENUE_TREND_DAYS,
        topServices);
  }

  /**
   * Issue #219/#220: Instant bounds (business timezone) of the trailing {@link
   * #REVENUE_TREND_DAYS}-day window ending today (inclusive) — the single day-range computation
   * {@code buildRevenueTrend} and {@code buildTopServices} both build on, so the revenue-trend
   * chart and the top-services chart always agree on exactly the same window rather than each
   * computing it independently.
   */
  private record RevenueWindow(LocalDate startDate, Instant start, Instant end) {}

  private static RevenueWindow revenueWindow(ZoneId zone, LocalDate today) {
    LocalDate startDate = today.minusDays(REVENUE_TREND_DAYS - 1L);
    Instant start = startDate.atStartOfDay(zone).toInstant();
    Instant end = today.plusDays(1).atStartOfDay(zone).toInstant();
    return new RevenueWindow(startDate, start, end);
  }

  /**
   * Issue #219: sums {@code ISSUED} invoice totals per calendar day (business timezone, same
   * non-REJECTED-SIFEN-outcome filter as {@code revenueDay}/{@code revenueWeek}) over the trailing
   * {@link #REVENUE_TREND_DAYS}-day window ending today (inclusive). Always returns exactly {@link
   * #REVENUE_TREND_DAYS} points, oldest first, one per day — days with no invoices get {@code
   * BigDecimal.ZERO}, never a gap, so the frontend chart's x-axis is always a fixed, contiguous
   * range.
   */
  private List<DashboardResponse.RevenueTrendPoint> buildRevenueTrend(
      long tenantId, ZoneId zone, LocalDate today) {
    RevenueWindow window = revenueWindow(zone, today);

    Map<LocalDate, BigDecimal> totalsByDay = new HashMap<>();
    for (InvoiceRevenueRow row :
        invoiceRepository.findRevenueRowsByTenantAndStatusAndIssuedBetween(
            tenantId, InvoiceStatus.ISSUED, window.start(), window.end())) {
      LocalDate day = row.issuedAt().atZone(zone).toLocalDate();
      totalsByDay.merge(day, nz(row.total()), BigDecimal::add);
    }

    List<DashboardResponse.RevenueTrendPoint> points = new ArrayList<>(REVENUE_TREND_DAYS);
    for (int i = 0; i < REVENUE_TREND_DAYS; i++) {
      LocalDate day = window.startDate().plusDays(i);
      points.add(
          new DashboardResponse.RevenueTrendPoint(
              day.toString(), totalsByDay.getOrDefault(day, BigDecimal.ZERO)));
    }
    return points;
  }

  private record InactiveCandidate(
      ClientRepository.InactiveClientRow row, long daysSinceLastVisit) {}

  /**
   * Issue #220 — "Dashboard: gráfico de servicios más vendidos": top {@link #TOP_SERVICES_LIMIT}
   * salon services by invoiced revenue (same window/filters as {@link #buildRevenueTrend} — {@code
   * ISSUED} + non-REJECTED SIFEN outcome), descending. Aggregation happens in SQL ({@code
   * InvoiceRepository#findServiceRevenueByTenantAndStatusAndIssuedBetween}); this method only caps
   * the already-descending result to the top N, same as {@code buildInactiveClients} capping to
   * {@link #INACTIVE_CLIENTS_LIMIT}.
   */
  private List<DashboardResponse.TopService> buildTopServices(
      long tenantId, ZoneId zone, LocalDate today) {
    RevenueWindow window = revenueWindow(zone, today);

    return invoiceRepository
        .findServiceRevenueByTenantAndStatusAndIssuedBetween(
            tenantId, InvoiceStatus.ISSUED, window.start(), window.end())
        .stream()
        .limit(TOP_SERVICES_LIMIT)
        .map(row -> new DashboardResponse.TopService(row.serviceName(), nz(row.totalRevenue())))
        .toList();
  }

  /**
   * Issue #216: active clients whose last {@code COMPLETED} appointment is {@value
   * #INACTIVE_CLIENT_THRESHOLD_DAYS}+ days old (or who never had one), ordered by days of
   * inactivity descending (never-visited clients sort first), capped to {@value
   * #INACTIVE_CLIENTS_LIMIT}.
   * Issue #216: active clients with at least one {@code COMPLETED} appointment whose most recent
   * one is {@value #INACTIVE_CLIENT_THRESHOLD_DAYS}+ days old — clients who never had a completed
   * visit are excluded (issue #216 follow-up: not visiting is "inactive", never having been a
   * client at all is not). Ordered by days of inactivity descending.
   */
  private List<InactiveCandidate> computeInactiveCandidates(
      long tenantId, ZoneId zone, LocalDate today) {
    List<InactiveCandidate> candidates = new ArrayList<>();
    for (ClientRepository.InactiveClientRow row :
        clientRepository.findActiveClientsWithLastCompletedVisit(
            tenantId, AppointmentStatus.COMPLETED)) {
      Instant lastVisit = row.getLastCompletedVisit();
      if (lastVisit == null) {
        continue;
      }
      long daysSinceLastVisit =
          ChronoUnit.DAYS.between(lastVisit.atZone(zone).toLocalDate(), today);
      if (daysSinceLastVisit >= INACTIVE_CLIENT_THRESHOLD_DAYS) {
        candidates.add(new InactiveCandidate(row, daysSinceLastVisit));
      }
    }
    candidates.sort(Comparator.comparingLong(InactiveCandidate::daysSinceLastVisit).reversed());
    return candidates;
  }

  private static DashboardResponse.InactiveClient toInactiveClient(InactiveCandidate c) {
    return new DashboardResponse.InactiveClient(
        c.row().getClientId(),
        c.row().getFullName(),
        c.row().getPhone(),
        c.daysSinceLastVisit(),
        c.row().getLastCompletedVisit().toString());
  }

  /** Dashboard widget: top {@value #INACTIVE_CLIENTS_LIMIT} most-inactive clients. */
  private List<DashboardResponse.InactiveClient> buildInactiveClients(
      long tenantId, ZoneId zone, LocalDate today) {
    return computeInactiveCandidates(tenantId, zone, today).stream()
        .limit(INACTIVE_CLIENTS_LIMIT)
        .map(DashboardService::toInactiveClient)
        .toList();
  }

  /**
   * Issue #216 follow-up: the full "Ver todas" list backing a dedicated page, paginated in memory —
   * the day-of-inactivity filter depends on the tenant's timezone ("today"), which can't be pushed
   * into the JPQL query, and a salon's client base is small enough that loading it all and paging
   * in Java is simpler than a DB-level page query here.
   */
  @Transactional(readOnly = true)
  public PageResponse<DashboardResponse.InactiveClient> buildInactiveClientsPage(
      long tenantId, int page, int size) {
    var zone = timeProperties.zoneId();
    LocalDate today = ZonedDateTime.now(zone).toLocalDate();
    List<InactiveCandidate> all = computeInactiveCandidates(tenantId, zone, today);

    int boundedSize = Math.max(1, Math.min(size, 200));
    int totalElements = all.size();
    int totalPages = (int) Math.ceil(totalElements / (double) boundedSize);
    int from = Math.min(Math.max(page, 0) * boundedSize, totalElements);
    int to = Math.min(from + boundedSize, totalElements);

    List<DashboardResponse.InactiveClient> content =
        all.subList(from, to).stream().map(DashboardService::toInactiveClient).toList();
    return new PageResponse<>(content, page, boundedSize, totalElements, totalPages);
  }

  private static void addFiscalAlerts(
      FiscalStamp stamp, java.time.ZoneId zone, List<DashboardResponse.FiscalAlert> out) {
    LocalDate today = LocalDate.now(zone);
    LocalDate until = stamp.getValidUntil();
    boolean expired = until.isBefore(today);
    boolean rangeExhausted = stamp.getNextEmissionNumber() > stamp.getRangeTo();
    if (expired || rangeExhausted) {
      out.add(
          new DashboardResponse.FiscalAlert(
              "blocking",
              "fiscalExpiredOrExhausted",
              "The fiscal stamp is expired or the number range is exhausted. Add a new stamp in Settings."));
      return;
    }
    long days = java.time.temporal.ChronoUnit.DAYS.between(today, until);
    if (days >= 0 && days < 30) {
      out.add(
          new DashboardResponse.FiscalAlert(
              "warning", "fiscalExpiringSoon", "Timbrado expires in less than 30 days"));
    }
    int range = stamp.getRangeTo() - stamp.getRangeFrom() + 1;
    if (range > 0) {
      int remaining = stamp.getRangeTo() - stamp.getNextEmissionNumber() + 1;
      BigDecimal pct =
          BigDecimal.valueOf(remaining * 100L)
              .divide(BigDecimal.valueOf(range), 2, RoundingMode.HALF_UP);
      if (pct.compareTo(BigDecimal.TEN) < 0) {
        out.add(
            new DashboardResponse.FiscalAlert(
                "warning", "fiscalLowRange", "Less than 10% of invoice numbers remain"));
      }
    }
  }

  private static BigDecimal nz(BigDecimal v) {
    return v == null ? BigDecimal.ZERO : v;
  }
}
