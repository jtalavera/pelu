package com.cursorpoc.backend.commission;

import com.cursorpoc.backend.domain.CommissionEntry;
import com.cursorpoc.backend.domain.CommissionSettlement;
import com.cursorpoc.backend.domain.enums.CommissionEntrySource;
import com.cursorpoc.backend.domain.enums.CommissionSettlementStatus;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.domain.enums.ServiceKind;
import com.cursorpoc.backend.repository.CommissionEntryRepository;
import com.cursorpoc.backend.repository.CommissionSettlementRepository;
import com.cursorpoc.backend.repository.CommissionSettlementStatusChangeRepository;
import com.cursorpoc.backend.web.dto.CommissionDtos.EntryView;
import com.cursorpoc.backend.web.dto.CommissionDtos.LineWithoutBeneficiary;
import com.cursorpoc.backend.web.dto.CommissionDtos.MyEntryView;
import com.cursorpoc.backend.web.dto.CommissionDtos.MySettlementDetail;
import com.cursorpoc.backend.web.dto.CommissionDtos.MySummary;
import com.cursorpoc.backend.web.dto.CommissionDtos.PagedSettlements;
import com.cursorpoc.backend.web.dto.CommissionDtos.PeriodInfo;
import com.cursorpoc.backend.web.dto.CommissionDtos.ReportResponse;
import com.cursorpoc.backend.web.dto.CommissionDtos.ReportRow;
import com.cursorpoc.backend.web.dto.CommissionDtos.SettlementDetail;
import com.cursorpoc.backend.web.dto.CommissionDtos.SettlementPreview;
import com.cursorpoc.backend.web.dto.CommissionDtos.SettlementView;
import com.cursorpoc.backend.web.dto.CommissionDtos.StatusChangeView;
import com.cursorpoc.backend.web.dto.CommissionDtos.Subtotal;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Read side: simulator (HU-COM-03), settlements (HU-COM-06), own view (HU-COM-07), reports. */
@Service
@Transactional(readOnly = true)
public class CommissionQueryService {

  private final CommissionEntryRepository entryRepository;
  private final CommissionSettlementRepository settlementRepository;
  private final CommissionSettlementStatusChangeRepository changeRepository;
  private final CommissionConfigService configService;
  private final CommissionLedger ledger;
  private final EntityManager entityManager;

  public CommissionQueryService(
      CommissionEntryRepository entryRepository,
      CommissionSettlementRepository settlementRepository,
      CommissionSettlementStatusChangeRepository changeRepository,
      CommissionConfigService configService,
      CommissionLedger ledger,
      EntityManager entityManager) {
    this.entryRepository = entryRepository;
    this.settlementRepository = settlementRepository;
    this.changeRepository = changeRepository;
    this.configService = configService;
    this.ledger = ledger;
    this.entityManager = entityManager;
  }

  // ── Settlement preview (replaces the simulator) ──────────────────────────────────────────

  /**
   * What the professional would be paid today for an open period: exactly the entries a settlement
   * generated now for {@code [from, to]} would take (unsettled entries accrued up to {@code to},
   * including carried balances and reversals). Read-only.
   */
  public SettlementPreview settlementPreview(
      long tenantId, long professionalId, LocalDate from, LocalDate to) {
    Map<Long, String> names = configService.professionalNames(tenantId);
    if (!names.containsKey(professionalId)) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "PROFESSIONAL_NOT_FOUND");
    }
    ZoneId zone = configService.zone();
    PeriodInfo period = configService.currentPeriod(ledger.snapshot(tenantId), Instant.now());
    LocalDate today = LocalDate.now(zone);
    LocalDate f =
        from != null ? from : period.from() != null ? period.from() : today.withDayOfMonth(1);
    LocalDate t = to != null ? to : period.to() != null ? period.to() : today;
    if (t.isBefore(f)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "COMMISSION_PERIOD_INVALID");
    }
    List<CommissionEntry> entries =
        entryRepository.findUnsettled(
            tenantId, professionalId, t.plusDays(1).atStartOfDay(zone).toInstant());
    java.util.Set<Long> reversed = entryRepository.findReversedIds(tenantId);
    BigDecimal services = BigDecimal.ZERO;
    BigDecimal products = BigDecimal.ZERO;
    BigDecimal adjustments = BigDecimal.ZERO;
    int lines = 0;
    for (CommissionEntry e : entries) {
      if (e.getSourceType() == CommissionEntrySource.ADJUSTMENT) {
        adjustments = adjustments.add(e.getCommissionAmount());
      } else if (e.getItemKind() == ServiceKind.PRODUCT) {
        products = products.add(e.getCommissionAmount());
      } else {
        services = services.add(e.getCommissionAmount());
      }
      if (e.getSourceType() == CommissionEntrySource.INVOICE_LINE) {
        lines++;
      }
    }
    List<SettlementView> drafts =
        settlementRepository
            .findByTenantIdAndProfessionalIdOrderByPeriodFromDescIdDesc(tenantId, professionalId)
            .stream()
            .filter(x -> x.getStatus() == CommissionSettlementStatus.DRAFT)
            .map(x -> view(x, names))
            .toList();
    return new SettlementPreview(
        professionalId,
        names.get(professionalId),
        f,
        t,
        services.add(products).add(adjustments),
        services,
        products,
        adjustments,
        lines,
        entries.stream().map(e -> entryView(e, names, null, reversed)).toList(),
        drafts);
  }

  // ── Settlements ───────────────────────────────────────────────────────────────────────────

  public PagedSettlements listSettlements(
      long tenantId,
      Long professionalId,
      String status,
      LocalDate from,
      LocalDate to,
      int page,
      int size) {
    Map<Long, String> names = configService.professionalNames(tenantId);
    List<CommissionSettlement> all =
        settlementRepository.findByTenantIdOrderByPeriodFromDescIdDesc(tenantId).stream()
            .filter(s -> professionalId == null || s.getProfessionalId().equals(professionalId))
            .filter(s -> status == null || status.isBlank() || s.getStatus().name().equals(status))
            .filter(s -> from == null || !s.getPeriodTo().isBefore(from))
            .filter(s -> to == null || !s.getPeriodFrom().isAfter(to))
            .toList();
    int safeSize = Math.max(1, Math.min(size, 100));
    int start = Math.max(0, page) * safeSize;
    List<SettlementView> items =
        all.stream().skip(start).limit(safeSize).map(s -> view(s, names)).toList();
    return new PagedSettlements(items, Math.max(0, page), safeSize, all.size());
  }

  public SettlementDetail settlementDetail(long tenantId, long settlementId) {
    CommissionSettlement s =
        settlementRepository
            .findByIdAndTenantId(settlementId, tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "SETTLEMENT_NOT_FOUND"));
    Map<Long, String> names = configService.professionalNames(tenantId);
    List<CommissionEntry> entries =
        entryRepository.findBySettlementIdOrderByAccrualAtAscIdAsc(s.getId());
    List<EntryView> lines = new ArrayList<>();
    List<EntryView> adjustments = new ArrayList<>();
    java.util.Set<Long> reversed = entryRepository.findReversedIds(tenantId);
    for (CommissionEntry e : entries) {
      EntryView v = entryView(e, names, s.getStatus(), reversed);
      if (e.getSourceType() == CommissionEntrySource.ADJUSTMENT) {
        adjustments.add(v);
      } else {
        lines.add(v);
      }
    }
    List<CommissionEntry> itemEntries =
        entries.stream()
            .filter(e -> e.getSourceType() != CommissionEntrySource.ADJUSTMENT)
            .toList();
    boolean mixed =
        itemEntries.stream()
                .filter(e -> e.getSourceType() == CommissionEntrySource.INVOICE_LINE)
                .map(CommissionEntry::getBaseType)
                .distinct()
                .count()
            > 1;
    List<StatusChangeView> history =
        changeRepository.findBySettlementIdOrderByChangedAtAscIdAsc(s.getId()).stream()
            .map(
                c ->
                    new StatusChangeView(
                        c.getFromStatus() == null ? null : c.getFromStatus().name(),
                        c.getToStatus().name(),
                        c.getChangedAt(),
                        c.getChangedByEmail()))
            .toList();
    return new SettlementDetail(
        view(s, names),
        lines,
        adjustments,
        subtotals(itemEntries, e -> String.valueOf(e.getServiceId()), CommissionEntry::getItemName),
        subtotals(itemEntries, e -> kindOf(e), e -> kindOf(e)),
        mixed,
        history);
  }

  private static String kindOf(CommissionEntry e) {
    return e.getItemKind() == null ? ServiceKind.SERVICE.name() : e.getItemKind().name();
  }

  static List<Subtotal> subtotals(
      List<CommissionEntry> entries,
      Function<CommissionEntry, String> key,
      Function<CommissionEntry, String> label) {
    Map<String, Subtotal> map = new LinkedHashMap<>();
    for (CommissionEntry e : entries) {
      String k = key.apply(e);
      Subtotal prev = map.get(k);
      int lineCount = e.getSourceType() == CommissionEntrySource.INVOICE_LINE ? 1 : 0;
      map.put(
          k,
          prev == null
              ? new Subtotal(k, label.apply(e), e.getCommissionAmount(), lineCount)
              : new Subtotal(
                  k,
                  prev.label(),
                  prev.amount().add(e.getCommissionAmount()),
                  prev.lines() + lineCount));
    }
    return new ArrayList<>(map.values());
  }

  public SettlementView view(CommissionSettlement s, Map<Long, String> names) {
    return new SettlementView(
        s.getId(),
        s.getProfessionalId(),
        names.get(s.getProfessionalId()),
        s.getPeriodFrom(),
        s.getPeriodTo(),
        s.getStatus().name(),
        s.getTotalAmount(),
        s.getCreatedAt(),
        s.getApprovedAt(),
        s.getPaidAt(),
        s.getPaymentMethod(),
        s.getPaymentReference(),
        s.getVoidReason());
  }

  public EntryView entryView(
      CommissionEntry e,
      Map<Long, String> names,
      CommissionSettlementStatus settlementStatus,
      java.util.Set<Long> reversedIds) {
    return new EntryView(
        e.getId(),
        e.getProfessionalId(),
        names.get(e.getProfessionalId()),
        e.getSourceType().name(),
        e.getRevision(),
        e.getReasonCode(),
        e.getInvoiceId(),
        e.getInvoiceNumber(),
        e.getServiceId(),
        e.getItemName(),
        e.getItemKind() == null ? null : e.getItemKind().name(),
        e.getBaseType() == null ? null : e.getBaseType().name(),
        e.getLineTotal(),
        e.getTaxAmount(),
        e.getBaseAmount(),
        e.getPercentApplied(),
        e.getRuleOrigin() == null ? null : e.getRuleOrigin().name(),
        e.getCommissionAmount(),
        e.getAccrualAt(),
        e.getReversesEntryId(),
        e.getSettlementId(),
        settlementStatus == null ? null : settlementStatus.name(),
        e.getNote(),
        e.getSourceType() == CommissionEntrySource.INVOICE_LINE
            && !reversedIds.contains(e.getId()));
  }

  // ── Entries & reports (HU-COM-08) ─────────────────────────────────────────────────────────

  public List<EntryView> entries(
      long tenantId,
      LocalDate from,
      LocalDate to,
      Long professionalId,
      String kind,
      String settlementState) {
    ZoneId zone = configService.zone();
    Instant fromI =
        (from != null ? from : LocalDate.now(zone).withDayOfMonth(1))
            .atStartOfDay(zone)
            .toInstant();
    Instant toI =
        (to != null ? to : LocalDate.now(zone)).plusDays(1).atStartOfDay(zone).toInstant();
    Map<Long, String> names = configService.professionalNames(tenantId);
    Map<Long, CommissionSettlementStatus> statuses = new HashMap<>();
    List<EntryView> out = new ArrayList<>();
    java.util.Set<Long> reversed = entryRepository.findReversedIds(tenantId);
    for (CommissionEntry e : entryRepository.findForReport(tenantId, fromI, toI, professionalId)) {
      if (kind != null
          && !kind.isBlank()
          && (e.getItemKind() == null || !e.getItemKind().name().equals(kind))) {
        continue;
      }
      CommissionSettlementStatus st =
          e.getSettlementId() == null
              ? null
              : statuses.computeIfAbsent(e.getSettlementId(), ledger::statusOf);
      String state = st == null ? "UNSETTLED" : st.name();
      if (settlementState != null && !settlementState.isBlank() && !settlementState.equals(state)) {
        continue;
      }
      out.add(entryView(e, names, st, reversed));
    }
    return out;
  }

  public ReportResponse report(
      long tenantId,
      LocalDate from,
      LocalDate to,
      Long professionalId,
      String kind,
      String settlementState) {
    ZoneId zone = configService.zone();
    LocalDate f = from != null ? from : LocalDate.now(zone).withDayOfMonth(1);
    LocalDate t = to != null ? to : LocalDate.now(zone);
    List<EntryView> entries = entries(tenantId, f, t, professionalId, kind, settlementState);
    BigDecimal total =
        entries.stream().map(EntryView::commissionAmount).reduce(BigDecimal.ZERO, BigDecimal::add);
    return new ReportResponse(
        f,
        t,
        total,
        group(
            entries,
            e -> String.valueOf(e.professionalId()),
            EntryView::professionalName,
            e -> null),
        group(
            entries.stream().filter(e -> e.serviceId() != null).toList(),
            e -> String.valueOf(e.serviceId()),
            EntryView::itemName,
            EntryView::itemKind),
        group(
            entries.stream().filter(e -> e.itemKind() != null).toList(),
            EntryView::itemKind,
            EntryView::itemKind,
            EntryView::itemKind),
        group(
            entries,
            e ->
                LocalDate.ofInstant(e.accrualAt(), zone)
                    .withDayOfMonth(1)
                    .toString()
                    .substring(0, 7),
            e -> LocalDate.ofInstant(e.accrualAt(), zone).toString().substring(0, 7),
            e -> null));
  }

  private static List<ReportRow> group(
      List<EntryView> entries,
      Function<EntryView, String> key,
      Function<EntryView, String> label,
      Function<EntryView, String> kind) {
    Map<String, ReportRow> map = new LinkedHashMap<>();
    for (EntryView e : entries) {
      String k = key.apply(e);
      int line = "INVOICE_LINE".equals(e.sourceType()) ? 1 : 0;
      ReportRow prev = map.get(k);
      map.put(
          k,
          prev == null
              ? new ReportRow(k, label.apply(e), kind.apply(e), e.commissionAmount(), line)
              : new ReportRow(
                  k,
                  prev.label(),
                  prev.itemKind(),
                  prev.amount().add(e.commissionAmount()),
                  prev.lines() + line));
    }
    List<ReportRow> rows = new ArrayList<>(map.values());
    rows.sort(Comparator.comparing(ReportRow::amount).reversed());
    return rows;
  }

  /** HU-COM-04 / C17: issued, non-voided catalog lines with no beneficiary. */
  @SuppressWarnings("unchecked")
  public List<LineWithoutBeneficiary> linesWithoutBeneficiary(
      long tenantId, LocalDate from, LocalDate to) {
    ZoneId zone = configService.zone();
    Instant fromI =
        (from != null ? from : LocalDate.now(zone).withDayOfMonth(1))
            .atStartOfDay(zone)
            .toInstant();
    Instant toI =
        (to != null ? to : LocalDate.now(zone)).plusDays(1).atStartOfDay(zone).toInstant();
    List<Object[]> rows =
        entityManager
            .createQuery(
                """
                SELECT l.id, i.id, i.invoiceNumber, i.issuedAt, l.description, s.kind, l.lineTotal
                FROM InvoiceLine l JOIN l.invoice i JOIN l.salonService s
                WHERE i.tenant.id = :tenantId AND i.status <> :voided
                  AND l.professional IS NULL
                  AND i.issuedAt >= :from AND i.issuedAt < :to
                ORDER BY i.issuedAt DESC
                """)
            .setParameter("tenantId", tenantId)
            .setParameter("voided", InvoiceStatus.VOIDED)
            .setParameter("from", fromI)
            .setParameter("to", toI)
            .setMaxResults(500)
            .getResultList();
    return rows.stream()
        .map(
            r ->
                new LineWithoutBeneficiary(
                    (Long) r[0],
                    (Long) r[1],
                    String.format("%07d", (Integer) r[2]),
                    (Instant) r[3],
                    (String) r[4],
                    r[5] == null ? null : r[5].toString(),
                    (BigDecimal) r[6]))
        .toList();
  }

  // ── Own view (HU-COM-07): no IVA breakdown, no line totals ────────────────────────────────

  public MySummary mySummary(long tenantId, long professionalId) {
    CommissionConfigSnapshot snapshot = ledger.snapshot(tenantId);
    Instant now = Instant.now();
    ZoneId zone = configService.zone();
    PeriodInfo period = configService.currentPeriod(snapshot, now);
    LocalDate from = period.from() != null ? period.from() : LocalDate.now(zone).withDayOfMonth(1);
    LocalDate to = period.to() != null ? period.to() : LocalDate.now(zone);
    List<CommissionEntry> entries =
        entryRepository.findForReport(
            tenantId,
            from.atStartOfDay(zone).toInstant(),
            to.plusDays(1).atStartOfDay(zone).toInstant(),
            professionalId);
    BigDecimal services = sumKind(entries, ServiceKind.SERVICE);
    BigDecimal products = sumKind(entries, ServiceKind.PRODUCT);
    BigDecimal total =
        entries.stream()
            .map(CommissionEntry::getCommissionAmount)
            .reduce(BigDecimal.ZERO, BigDecimal::add);
    Map<Long, String> names = configService.professionalNames(tenantId);
    List<SettlementView> settlements =
        settlementRepository
            .findByTenantIdAndProfessionalIdOrderByPeriodFromDescIdDesc(tenantId, professionalId)
            .stream()
            .filter(s -> s.getStatus() != CommissionSettlementStatus.VOIDED)
            .map(s -> view(s, names))
            .toList();
    return new MySummary(
        period,
        total,
        services,
        products,
        entries.stream().map(CommissionQueryService::myView).toList(),
        settlements);
  }

  public MySettlementDetail mySettlement(long tenantId, long professionalId, long settlementId) {
    CommissionSettlement s =
        settlementRepository
            .findByIdAndTenantId(settlementId, tenantId)
            .filter(x -> x.getProfessionalId() == professionalId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "SETTLEMENT_NOT_FOUND"));
    List<CommissionEntry> entries =
        entryRepository.findBySettlementIdOrderByAccrualAtAscIdAsc(s.getId());
    return new MySettlementDetail(
        view(s, configService.professionalNames(tenantId)),
        entries.stream().map(CommissionQueryService::myView).toList(),
        subtotals(
            entries.stream()
                .filter(e -> e.getSourceType() != CommissionEntrySource.ADJUSTMENT)
                .toList(),
            CommissionQueryService::kindOf,
            CommissionQueryService::kindOf));
  }

  private static BigDecimal sumKind(List<CommissionEntry> entries, ServiceKind kind) {
    return entries.stream()
        .filter(e -> e.getItemKind() == kind)
        .map(CommissionEntry::getCommissionAmount)
        .reduce(BigDecimal.ZERO, BigDecimal::add);
  }

  static MyEntryView myView(CommissionEntry e) {
    return new MyEntryView(
        e.getId(),
        e.getSourceType().name(),
        e.getReasonCode(),
        e.getInvoiceNumber(),
        e.getItemName(),
        e.getItemKind() == null ? null : e.getItemKind().name(),
        e.getBaseType() == null ? null : e.getBaseType().name(),
        e.getBaseAmount(),
        e.getPercentApplied(),
        e.getCommissionAmount(),
        e.getAccrualAt(),
        e.getNote());
  }
}
