package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.ServiceRecordTip;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.TipWithdrawal;
import com.cursorpoc.backend.domain.enums.ServiceRecordStatus;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.ServiceRecordTipRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.repository.TipWithdrawalRepository;
import com.cursorpoc.backend.web.dto.CreateTipWithdrawalResponse;
import com.cursorpoc.backend.web.dto.PagedTipWithdrawalsResponse;
import com.cursorpoc.backend.web.dto.ProfessionalTipBalanceResponse;
import com.cursorpoc.backend.web.dto.TipReportProfessionalTotalResponse;
import com.cursorpoc.backend.web.dto.TipReportResponse;
import com.cursorpoc.backend.web.dto.TipReportRowResponse;
import com.cursorpoc.backend.web.dto.TipWithdrawalHistoryItemResponse;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class TipsService {

  private final ServiceRecordTipRepository serviceRecordTipRepository;
  private final TipWithdrawalRepository tipWithdrawalRepository;
  private final ProfessionalRepository professionalRepository;
  private final TenantRepository tenantRepository;
  private final AppUserRepository appUserRepository;

  public TipsService(
      ServiceRecordTipRepository serviceRecordTipRepository,
      TipWithdrawalRepository tipWithdrawalRepository,
      ProfessionalRepository professionalRepository,
      TenantRepository tenantRepository,
      AppUserRepository appUserRepository) {
    this.serviceRecordTipRepository = serviceRecordTipRepository;
    this.tipWithdrawalRepository = tipWithdrawalRepository;
    this.professionalRepository = professionalRepository;
    this.tenantRepository = tenantRepository;
    this.appUserRepository = appUserRepository;
  }

  @Transactional(readOnly = true)
  public TipReportResponse getReport(
      long tenantId, Instant fromDate, Instant toDate, List<Long> professionalIds) {
    List<Long> resolvedProfessionalIds = resolveProfessionalIds(tenantId, professionalIds);
    if (resolvedProfessionalIds.isEmpty()) {
      return new TipReportResponse(List.of(), List.of(), BigDecimal.ZERO);
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
                        t.getProfessional().getFullName(),
                        t.getAmount(),
                        t.getServiceRecord().getClient().getFullName(),
                        t.getServiceRecord().getClosedAt()))
            .toList();

    Map<Long, TipReportProfessionalTotalResponse> totalsByProfessional = new LinkedHashMap<>();
    BigDecimal grandTotal = BigDecimal.ZERO;
    for (TipReportRowResponse row : rows) {
      TipReportProfessionalTotalResponse existing = totalsByProfessional.get(row.professionalId());
      BigDecimal newTotal =
          (existing != null ? existing.total() : BigDecimal.ZERO).add(row.amount());
      totalsByProfessional.put(
          row.professionalId(),
          new TipReportProfessionalTotalResponse(
              row.professionalId(), row.professionalName(), newTotal));
      grandTotal = grandTotal.add(row.amount());
    }

    return new TipReportResponse(rows, List.copyOf(totalsByProfessional.values()), grandTotal);
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

    BigDecimal newBalance = balance.subtract(amount);
    return new CreateTipWithdrawalResponse(
        new TipWithdrawalHistoryItemResponse(
            withdrawal.getId(), withdrawal.getAmount(), withdrawal.getWithdrawnAt()),
        newBalance);
  }

  @Transactional(readOnly = true)
  public PagedTipWithdrawalsResponse listWithdrawals(
      long tenantId, long professionalId, int page, int size) {
    requireProfessional(tenantId, professionalId);
    Page<TipWithdrawal> result =
        tipWithdrawalRepository.findByTenant_IdAndProfessional_IdOrderByWithdrawnAtDesc(
            tenantId, professionalId, PageRequest.of(page, size));
    List<TipWithdrawalHistoryItemResponse> content =
        result.getContent().stream()
            .map(
                w ->
                    new TipWithdrawalHistoryItemResponse(
                        w.getId(), w.getAmount(), w.getWithdrawnAt()))
            .toList();
    return new PagedTipWithdrawalsResponse(
        content, page, size, result.getTotalElements(), result.getTotalPages());
  }

  private BigDecimal computeBalance(long tenantId, long professionalId) {
    BigDecimal tipsTotal =
        serviceRecordTipRepository.sumForProfessional(
            tenantId, professionalId, ServiceRecordStatus.CLOSED);
    BigDecimal withdrawalsTotal =
        tipWithdrawalRepository.sumForProfessional(tenantId, professionalId);
    return tipsTotal.subtract(withdrawalsTotal);
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
