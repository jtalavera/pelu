package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.CashSession;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.CashSessionRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.CashSessionCloseRequest;
import com.cursorpoc.backend.web.dto.CashSessionCloseResponse;
import com.cursorpoc.backend.web.dto.CashSessionOpenRequest;
import com.cursorpoc.backend.web.dto.CashSessionResponse;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class CashSessionService {

  private final CashSessionRepository cashSessionRepository;
  private final TenantRepository tenantRepository;
  private final AppUserRepository appUserRepository;
  private final InvoiceRepository invoiceRepository;

  public CashSessionService(
      CashSessionRepository cashSessionRepository,
      TenantRepository tenantRepository,
      AppUserRepository appUserRepository,
      InvoiceRepository invoiceRepository) {
    this.cashSessionRepository = cashSessionRepository;
    this.tenantRepository = tenantRepository;
    this.appUserRepository = appUserRepository;
    this.invoiceRepository = invoiceRepository;
  }

  @Transactional(readOnly = true)
  public Optional<CashSessionResponse> getCurrentSession(long tenantId) {
    return cashSessionRepository
        .findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(tenantId)
        .map(CashSessionService::toDto);
  }

  @Transactional
  public CashSessionResponse openSession(
      long tenantId, long userId, CashSessionOpenRequest request) {
    cashSessionRepository
        .findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(tenantId)
        .ifPresent(
            existing -> {
              throw new ResponseStatusException(HttpStatus.CONFLICT, "CASH_SESSION_ALREADY_OPEN");
            });

    Tenant tenant =
        tenantRepository
            .findById(tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND"));

    AppUser openedBy =
        appUserRepository
            .findById(userId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND"));

    CashSession session = new CashSession();
    session.setTenant(tenant);
    session.setOpenedByUser(openedBy);
    session.setOpenedAt(Instant.now());
    session.setOpeningCashAmount(request.openingCashAmount());

    cashSessionRepository.save(session);
    return toDto(session);
  }

  @Transactional
  public CashSessionCloseResponse closeSession(
      long tenantId, long userId, CashSessionCloseRequest request) {
    CashSession session =
        cashSessionRepository
            .findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.CONFLICT, "CASH_SESSION_NOT_OPEN"));

    AppUser closedBy =
        appUserRepository
            .findById(userId)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND"));

    session.setClosedAt(Instant.now());
    session.setClosedByUser(closedBy);
    session.setCountedCashAmount(request.countedCashAmount());

    // Compute summary
    BigDecimal totalInvoiced =
        invoiceRepository.sumTotalByCashSessionAndStatus(session.getId(), InvoiceStatus.ISSUED);
    long invoiceCount =
        invoiceRepository.countByCashSessionAndStatus(session.getId(), InvoiceStatus.ISSUED);

    List<Object[]> paymentRows =
        cashSessionRepository.sumPaymentsByMethodForSession(session.getId());
    List<CashSessionCloseResponse.PaymentMethodSummary> paymentSummary = new ArrayList<>();
    BigDecimal expectedCash = BigDecimal.ZERO;
    for (Object[] row : paymentRows) {
      String method = String.valueOf(row[0]);
      BigDecimal amount = (BigDecimal) row[1];
      paymentSummary.add(new CashSessionCloseResponse.PaymentMethodSummary(method, amount));
      if ("CASH".equals(method)) {
        expectedCash = amount;
      }
    }

    BigDecimal countedCash = request.countedCashAmount();
    BigDecimal cashDifference = countedCash.subtract(expectedCash);

    return new CashSessionCloseResponse(
        session.getId(),
        tenantId,
        session.getOpenedAt(),
        session.getClosedAt(),
        closedBy.getEmail(),
        session.getOpeningCashAmount(),
        countedCash,
        expectedCash,
        cashDifference,
        totalInvoiced,
        (int) invoiceCount,
        paymentSummary);
  }

  private static CashSessionResponse toDto(CashSession s) {
    return new CashSessionResponse(
        s.getId(),
        s.getTenant().getId(),
        s.getOpenedByUser().getId(),
        s.getOpenedByUser().getEmail(),
        s.getOpenedAt(),
        s.getOpeningCashAmount(),
        s.getClosedAt() == null);
  }
}
