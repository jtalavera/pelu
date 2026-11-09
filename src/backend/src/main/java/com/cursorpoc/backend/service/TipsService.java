package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.CashMovement;
import com.cursorpoc.backend.domain.CashSession;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.ManualTip;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.ServiceRecordTip;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.TipWithdrawal;
import com.cursorpoc.backend.domain.enums.CashMovementType;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.domain.enums.ServiceRecordStatus;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.CashMovementRepository;
import com.cursorpoc.backend.repository.CashSessionRepository;
import com.cursorpoc.backend.repository.InvoiceTipRepository;
import com.cursorpoc.backend.repository.ManualTipRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.ServiceRecordTipRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.repository.TipWithdrawalRepository;
import com.cursorpoc.backend.web.dto.CreateTipWithdrawalResponse;
import com.cursorpoc.backend.web.dto.ManualTipMutationResponse;
import com.cursorpoc.backend.web.dto.ManualTipResponse;
import com.cursorpoc.backend.web.dto.PagedTipWithdrawalsResponse;
import com.cursorpoc.backend.web.dto.ProfessionalTipBalanceResponse;
import com.cursorpoc.backend.web.dto.TipReportProfessionalTotalResponse;
import com.cursorpoc.backend.web.dto.TipReportResponse;
import com.cursorpoc.backend.web.dto.TipReportRowResponse;
import com.cursorpoc.backend.web.dto.TipWithdrawalHistoryItemResponse;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class TipsService {

  private final ServiceRecordTipRepository serviceRecordTipRepository;
  private final InvoiceTipRepository invoiceTipRepository;
  private final TipWithdrawalRepository tipWithdrawalRepository;
  private final ProfessionalRepository professionalRepository;
  private final TenantRepository tenantRepository;
  private final AppUserRepository appUserRepository;
  private final CashSessionRepository cashSessionRepository;
  private final CashMovementRepository cashMovementRepository;
  private final ManualTipRepository manualTipRepository;

  public TipsService(
      ServiceRecordTipRepository serviceRecordTipRepository,
      InvoiceTipRepository invoiceTipRepository,
      TipWithdrawalRepository tipWithdrawalRepository,
      ProfessionalRepository professionalRepository,
      TenantRepository tenantRepository,
      AppUserRepository appUserRepository,
      CashSessionRepository cashSessionRepository,
      CashMovementRepository cashMovementRepository,
      ManualTipRepository manualTipRepository) {
    this.serviceRecordTipRepository = serviceRecordTipRepository;
    this.invoiceTipRepository = invoiceTipRepository;
    this.tipWithdrawalRepository = tipWithdrawalRepository;
    this.professionalRepository = professionalRepository;
    this.tenantRepository = tenantRepository;
    this.appUserRepository = appUserRepository;
    this.cashSessionRepository = cashSessionRepository;
    this.cashMovementRepository = cashMovementRepository;
    this.manualTipRepository = manualTipRepository;
  }

  @Transactional(readOnly = true)
  public TipReportResponse getReport(
      long tenantId, Instant fromDate, Instant toDate, List<Long> professionalIds) {
    fromDate =
        SearchRangeLimits.resolveFrom(fromDate, ZoneId.systemDefault(), SearchRangeLimits.TOO_OLD);
    List<Long> resolvedProfessionalIds = resolveProfessionalIds(tenantId, professionalIds);
    if (resolvedProfessionalIds.isEmpty()) {
      return new TipReportResponse(
          List.of(), List.of(), BigDecimal.ZERO, BigDecimal.ZERO, List.of());
    }
    List<ServiceRecordTip> tips =
        serviceRecordTipRepository.findForReport(
            tenantId, ServiceRecordStatus.CLOSED, fromDate, toDate, resolvedProfessionalIds);

    List<TipReportRowResponse> rows =
        tips.stream()
            .map(
                t ->
                    new TipReportRowResponse(
                        t.getProfessional().getId(),
                        t.getProfessional().getDisplayName(),
                        t.getAmount(),
                        t.getServiceRecord().getClient().getFullName(),
                        t.getServiceRecord().getClosedAt()))
            .collect(Collectors.toCollection(ArrayList::new));
    // Tips entered directly on a comprobante (not generated from a ficha) — voided invoices
    // excluded.
    invoiceTipRepository
        .findForReport(tenantId, InvoiceStatus.ISSUED, fromDate, toDate, resolvedProfessionalIds)
        .forEach(
            t ->
                rows.add(
                    new TipReportRowResponse(
                        t.getProfessional().getId(),
                        t.getProfessional().getDisplayName(),
                        t.getAmount(),
                        invoiceClientName(t.getInvoice()),
                        t.getInvoice().getIssuedAt())));
    // Tips loaded by hand by the administrator; voided ones are listed (flagged) but not counted.
    manualTipRepository
        .findForReport(tenantId, fromDate, toDate, resolvedProfessionalIds)
        .forEach(m -> rows.add(toReportRow(m)));
    rows.sort(
        Comparator.comparing(
                TipReportRowResponse::professionalName,
                Comparator.nullsLast(Comparator.<String>naturalOrder()))
            .thenComparing(
                TipReportRowResponse::serviceDateTime,
                Comparator.nullsLast(Comparator.<Instant>naturalOrder())));

    Map<Long, TipReportProfessionalTotalResponse> totalsByProfessional = new LinkedHashMap<>();
    BigDecimal grandTotal = BigDecimal.ZERO;
    for (TipReportRowResponse row : rows) {
      if (row.voided()) {
        continue;
      }
      TipReportProfessionalTotalResponse existing = totalsByProfessional.get(row.professionalId());
      BigDecimal newTotal =
          (existing != null ? existing.total() : BigDecimal.ZERO).add(row.amount());
      totalsByProfessional.put(
          row.professionalId(),
          new TipReportProfessionalTotalResponse(
              row.professionalId(), row.professionalName(), newTotal));
      grandTotal = grandTotal.add(row.amount());
    }

    // Withdrawals made within the same window must reduce the totals they were drawn from, or a
    // professional's report subtotal never reflects money they already took out.
    List<TipWithdrawal> withdrawalsInRange =
        tipWithdrawalRepository.findForReport(tenantId, fromDate, toDate, resolvedProfessionalIds);
    Map<Long, TipReportProfessionalTotalResponse> withdrawalsByProfessional = new LinkedHashMap<>();
    for (TipWithdrawal withdrawal : withdrawalsInRange) {
      Long professionalId = withdrawal.getProfessional().getId();
      TipReportProfessionalTotalResponse existing = withdrawalsByProfessional.get(professionalId);
      BigDecimal newTotal =
          (existing != null ? existing.total() : BigDecimal.ZERO).add(withdrawal.getAmount());
      withdrawalsByProfessional.put(
          professionalId,
          new TipReportProfessionalTotalResponse(
              professionalId, withdrawal.getProfessional().getDisplayName(), newTotal));
    }
    BigDecimal withdrawalsTotal = BigDecimal.ZERO;
    for (TipReportProfessionalTotalResponse withdrawalTotal : withdrawalsByProfessional.values()) {
      withdrawalsTotal = withdrawalsTotal.add(withdrawalTotal.total());
      TipReportProfessionalTotalResponse existing =
          totalsByProfessional.get(withdrawalTotal.professionalId());
      // A professional can withdraw within the window without having any tip rows in it (e.g. the
      // tip was earned earlier) — still surface them as their own group with a negative subtotal,
      // rather than silently dropping their withdrawal from the report.
      BigDecimal baseTotal = existing != null ? existing.total() : BigDecimal.ZERO;
      totalsByProfessional.put(
          withdrawalTotal.professionalId(),
          new TipReportProfessionalTotalResponse(
              withdrawalTotal.professionalId(),
              withdrawalTotal.professionalName(),
              baseTotal.subtract(withdrawalTotal.total())));
      grandTotal = grandTotal.subtract(withdrawalTotal.total());
    }

    return new TipReportResponse(
        rows,
        List.copyOf(totalsByProfessional.values()),
        grandTotal,
        withdrawalsTotal,
        List.copyOf(withdrawalsByProfessional.values()));
  }

  @Transactional(readOnly = true)
  public ProfessionalTipBalanceResponse getBalance(long tenantId, long professionalId) {
    Professional professional = requireProfessional(tenantId, professionalId);
    return new ProfessionalTipBalanceResponse(
        professional.getId(), professional.getFullName(), computeBalance(tenantId, professionalId));
  }

  @Transactional
  public CreateTipWithdrawalResponse createWithdrawal(
      long tenantId, long userId, long professionalId, BigDecimal amount) {
    Professional professional = requireProfessional(tenantId, professionalId);
    if (amount == null || amount.compareTo(BigDecimal.ZERO) <= 0) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "TIP_WITHDRAWAL_AMOUNT_INVALID");
    }
    BigDecimal balance = computeBalance(tenantId, professionalId);
    if (amount.compareTo(balance) > 0) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "TIP_WITHDRAWAL_EXCEEDS_BALANCE");
    }

    Tenant tenant =
        tenantRepository
            .findById(tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND"));
    AppUser createdBy = appUserRepository.findById(userId).orElse(null);

    TipWithdrawal withdrawal = new TipWithdrawal();
    withdrawal.setTenant(tenant);
    withdrawal.setProfessional(professional);
    withdrawal.setAmount(amount);
    withdrawal.setWithdrawnAt(Instant.now());
    withdrawal.setCreatedBy(createdBy);
    tipWithdrawalRepository.save(withdrawal);

    // The withdrawal takes cash out of the drawer: record it on the open register; with none open,
    // on the last closed one, flagged as "after close" so that register's figures stay frozen.
    CashSession openSession =
        cashSessionRepository
            .findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(tenantId)
            .orElse(null);
    boolean afterClose = openSession == null;
    CashSession target =
        openSession != null
            ? openSession
            : cashSessionRepository
                .findFirstByTenant_IdAndClosedAtIsNotNullOrderByClosedAtDesc(tenantId)
                .orElse(null);
    if (target != null) {
      CashMovement movement = new CashMovement();
      movement.setTenant(tenant);
      movement.setCashSession(target);
      movement.setType(CashMovementType.TIP_WITHDRAWAL_OUT);
      movement.setAmount(amount);
      movement.setTipWithdrawalId(withdrawal.getId());
      movement.setAfterClose(afterClose);
      movement.setCreatedByUser(createdBy);
      movement.setCreatedAt(Instant.now());
      cashMovementRepository.save(movement);
    }

    BigDecimal newBalance = balance.subtract(amount);
    return new CreateTipWithdrawalResponse(
        new TipWithdrawalHistoryItemResponse(
            withdrawal.getId(),
            professional.getDisplayName(),
            withdrawal.getAmount(),
            withdrawal.getWithdrawnAt()),
        newBalance,
        target != null ? target.getId() : null,
        target != null && afterClose);
  }

  /**
   * {@code professionalId} is optional: when omitted, returns the tenant-wide withdrawal history
   * (every professional) for the last 3 months — the always-visible default view in the Retiro de
   * propinas screen. When given, returns that professional's full all-time history, unchanged from
   * before this became optional.
   */
  @Transactional(readOnly = true)
  public PagedTipWithdrawalsResponse listWithdrawals(
      long tenantId, Long professionalId, int page, int size) {
    Page<TipWithdrawal> result;
    if (professionalId != null) {
      requireProfessional(tenantId, professionalId);
      result =
          tipWithdrawalRepository.findByTenant_IdAndProfessional_IdOrderByWithdrawnAtDesc(
              tenantId, professionalId, PageRequest.of(page, size));
    } else {
      Instant threeMonthsAgo = ZonedDateTime.now(ZoneOffset.UTC).minusMonths(3).toInstant();
      result =
          tipWithdrawalRepository.findByTenantSince(
              tenantId, threeMonthsAgo, PageRequest.of(page, size));
    }
    List<TipWithdrawalHistoryItemResponse> content =
        result.getContent().stream()
            .map(
                w ->
                    new TipWithdrawalHistoryItemResponse(
                        w.getId(),
                        w.getProfessional().getDisplayName(),
                        w.getAmount(),
                        w.getWithdrawnAt()))
            .toList();
    return new PagedTipWithdrawalsResponse(
        content, page, size, result.getTotalElements(), result.getTotalPages());
  }

  /** Longest note / void reason accepted (matches the column length). */
  static final int MANUAL_TIP_TEXT_MAX = 200;

  /**
   * Loads a tip by hand (salon administrator only — enforced by the controller). It adds to the
   * professional's accumulated balance right away.
   */
  @Transactional
  public ManualTipMutationResponse createManualTip(
      long tenantId,
      long userId,
      long professionalId,
      BigDecimal amount,
      Instant tippedAt,
      String note) {
    Professional professional = requireProfessional(tenantId, professionalId);
    if (!professional.isActive()) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "MANUAL_TIP_PROFESSIONAL_INACTIVE");
    }
    requireValidAmount(amount);
    requireValidDate(tippedAt);
    String cleanNote = cleanText(note, "MANUAL_TIP_NOTE_TOO_LONG");

    Tenant tenant =
        tenantRepository
            .findById(tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND"));
    ManualTip tip = new ManualTip();
    tip.setTenant(tenant);
    tip.setProfessional(professional);
    tip.setAmount(amount);
    tip.setTippedAt(tippedAt);
    tip.setNote(cleanNote);
    tip.setCreatedBy(appUserRepository.findById(userId).orElse(null));
    tip.setCreatedAt(Instant.now());
    manualTipRepository.save(tip);
    return new ManualTipMutationResponse(toResponse(tip), computeBalance(tenantId, professionalId));
  }

  /**
   * Edits amount, date or note of a manual tip that is not voided. The balance can never be left
   * negative: lowering the amount below what the professional already withdrew is refused.
   */
  @Transactional
  public ManualTipMutationResponse updateManualTip(
      long tenantId,
      long userId,
      long manualTipId,
      BigDecimal amount,
      Instant tippedAt,
      String note) {
    ManualTip tip = requireManualTip(tenantId, manualTipId);
    if (tip.isVoided()) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "MANUAL_TIP_ALREADY_VOIDED");
    }
    requireValidAmount(amount);
    requireValidDate(tippedAt);
    String cleanNote = cleanText(note, "MANUAL_TIP_NOTE_TOO_LONG");

    long professionalId = tip.getProfessional().getId();
    BigDecimal newBalance =
        computeBalance(tenantId, professionalId).subtract(tip.getAmount()).add(amount);
    if (newBalance.signum() < 0) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "MANUAL_TIP_EDIT_BELOW_WITHDRAWN");
    }
    tip.setAmount(amount);
    tip.setTippedAt(tippedAt);
    tip.setNote(cleanNote);
    tip.setUpdatedBy(appUserRepository.findById(userId).orElse(null));
    tip.setUpdatedAt(Instant.now());
    manualTipRepository.save(tip);
    return new ManualTipMutationResponse(toResponse(tip), newBalance);
  }

  /**
   * Voids a manual tip (it is never deleted): it stops counting in the balance but stays visible
   * with who voided it and why. Refused when the professional already withdrew that money.
   */
  @Transactional
  public ManualTipMutationResponse voidManualTip(
      long tenantId, long userId, long manualTipId, String reason) {
    ManualTip tip = requireManualTip(tenantId, manualTipId);
    if (tip.isVoided()) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "MANUAL_TIP_ALREADY_VOIDED");
    }
    String cleanReason = cleanText(reason, "MANUAL_TIP_VOID_REASON_TOO_LONG");
    if (cleanReason == null) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "MANUAL_TIP_VOID_REASON_REQUIRED");
    }
    long professionalId = tip.getProfessional().getId();
    BigDecimal newBalance = computeBalance(tenantId, professionalId).subtract(tip.getAmount());
    if (newBalance.signum() < 0) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "MANUAL_TIP_VOID_EXCEEDS_BALANCE");
    }
    tip.setVoidedAt(Instant.now());
    tip.setVoidedBy(appUserRepository.findById(userId).orElse(null));
    tip.setVoidReason(cleanReason);
    manualTipRepository.save(tip);
    return new ManualTipMutationResponse(toResponse(tip), newBalance);
  }

  private ManualTip requireManualTip(long tenantId, long manualTipId) {
    return manualTipRepository
        .findByIdAndTenant_Id(manualTipId, tenantId)
        .orElseThrow(
            () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "MANUAL_TIP_NOT_FOUND"));
  }

  private static void requireValidAmount(BigDecimal amount) {
    if (amount == null || amount.compareTo(BigDecimal.ONE) < 0) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "MANUAL_TIP_AMOUNT_INVALID");
    }
  }

  /** A tip cannot be dated in the future (one day of slack covers timezone differences). */
  private static void requireValidDate(Instant tippedAt) {
    if (tippedAt == null) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "MANUAL_TIP_DATE_REQUIRED");
    }
    if (tippedAt.isAfter(Instant.now().plus(Duration.ofDays(1)))) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "MANUAL_TIP_DATE_IN_FUTURE");
    }
  }

  /** Trims; blank becomes null; longer than the column allows is rejected with {@code tooLong}. */
  private static String cleanText(String value, String tooLongCode) {
    if (value == null || value.isBlank()) {
      return null;
    }
    String trimmed = value.trim();
    if (trimmed.length() > MANUAL_TIP_TEXT_MAX) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, tooLongCode);
    }
    return trimmed;
  }

  private static String userName(AppUser user) {
    if (user == null) {
      return null;
    }
    return user.getFullName() != null && !user.getFullName().isBlank()
        ? user.getFullName()
        : user.getEmail();
  }

  private static ManualTipResponse toResponse(ManualTip m) {
    return new ManualTipResponse(
        m.getId(),
        m.getProfessional().getId(),
        m.getProfessional().getDisplayName(),
        m.getAmount(),
        m.getTippedAt(),
        m.getNote(),
        userName(m.getCreatedBy()),
        m.isVoided(),
        m.getVoidReason(),
        userName(m.getVoidedBy()));
  }

  private static TipReportRowResponse toReportRow(ManualTip m) {
    return new TipReportRowResponse(
        m.getProfessional().getId(),
        m.getProfessional().getDisplayName(),
        m.getAmount(),
        null,
        m.getTippedAt(),
        m.getId(),
        m.getNote(),
        userName(m.getCreatedBy()),
        m.isVoided(),
        m.getVoidReason(),
        userName(m.getVoidedBy()));
  }

  private BigDecimal computeBalance(long tenantId, long professionalId) {
    BigDecimal tipsTotal =
        serviceRecordTipRepository
            .sumForProfessional(tenantId, professionalId, ServiceRecordStatus.CLOSED)
            .add(
                invoiceTipRepository.sumForProfessional(
                    tenantId, professionalId, InvoiceStatus.ISSUED))
            .add(manualTipRepository.sumForProfessional(tenantId, professionalId));
    BigDecimal withdrawalsTotal =
        tipWithdrawalRepository.sumForProfessional(tenantId, professionalId);
    return tipsTotal.subtract(withdrawalsTotal);
  }

  private static String invoiceClientName(Invoice invoice) {
    if (invoice.getClientDisplayName() != null && !invoice.getClientDisplayName().isBlank()) {
      return invoice.getClientDisplayName();
    }
    return invoice.getClient() != null ? invoice.getClient().getFullName() : null;
  }

  private Professional requireProfessional(long tenantId, long professionalId) {
    return professionalRepository
        .findByIdAndTenant_Id(professionalId, tenantId)
        .orElseThrow(
            () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "PROFESSIONAL_NOT_FOUND"));
  }

  /** Empty/null filter resolves to every active professional in the tenant. */
  private List<Long> resolveProfessionalIds(long tenantId, List<Long> professionalIds) {
    if (professionalIds != null && !professionalIds.isEmpty()) {
      return professionalIds;
    }
    return professionalRepository.findByTenant_IdOrderByFullNameAsc(tenantId).stream()
        .filter(Professional::isActive)
        .map(Professional::getId)
        .toList();
  }
}
