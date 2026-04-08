package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.FiscalStamp;
import com.cursorpoc.backend.domain.enums.AppointmentStatus;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.repository.FiscalStampRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.web.dto.DashboardResponse;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZonedDateTime;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DashboardService {

  private final FemmeTimeProperties timeProperties;
  private final AppointmentRepository appointmentRepository;
  private final InvoiceRepository invoiceRepository;
  private final FiscalStampRepository fiscalStampRepository;
  private final BusinessProfileService businessProfileService;

  public DashboardService(
      FemmeTimeProperties timeProperties,
      AppointmentRepository appointmentRepository,
      InvoiceRepository invoiceRepository,
      FiscalStampRepository fiscalStampRepository,
      BusinessProfileService businessProfileService) {
    this.timeProperties = timeProperties;
    this.appointmentRepository = appointmentRepository;
    this.invoiceRepository = invoiceRepository;
    this.fiscalStampRepository = fiscalStampRepository;
    this.businessProfileService = businessProfileService;
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
        .ifPresent(stamp -> addFiscalAlerts(stamp, zone, alerts));

    return new DashboardResponse(
        new DashboardResponse.AppointmentSummary(total, pending, confirmed, inProgress, completed),
        new DashboardResponse.RevenueSummary(invoicedDay, collectedDay),
        new DashboardResponse.RevenueSummary(invoicedWeek, collectedWeek),
        alerts);
  }

  private static void addFiscalAlerts(
      FiscalStamp stamp, java.time.ZoneId zone, List<DashboardResponse.FiscalAlert> out) {
    LocalDate today = LocalDate.now(zone);
    LocalDate until = stamp.getValidUntil();
    if (!until.isBefore(today)) {
      long days = java.time.temporal.ChronoUnit.DAYS.between(today, until);
      if (days >= 0 && days < 30) {
        out.add(
            new DashboardResponse.FiscalAlert(
                "warning", "fiscalExpiringSoon", "Timbrado expires in less than 30 days"));
      }
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
