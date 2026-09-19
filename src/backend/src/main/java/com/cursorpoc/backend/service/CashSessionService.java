package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.CashMovement;
import com.cursorpoc.backend.domain.CashSession;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.CashMovementType;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.CashMovementRepository;
import com.cursorpoc.backend.repository.CashSessionRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.CashMovementCreateRequest;
import com.cursorpoc.backend.web.dto.CashMovementResponse;
import com.cursorpoc.backend.web.dto.CashSessionCloseRequest;
import com.cursorpoc.backend.web.dto.CashSessionDetailResponse;
import com.cursorpoc.backend.web.dto.CashSessionListItemResponse;
import com.cursorpoc.backend.web.dto.CashSessionOpenRequest;
import com.cursorpoc.backend.web.dto.CashSessionResponse;
import com.cursorpoc.backend.web.dto.PagedCashSessionsResponse;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
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
  private final CashMovementRepository cashMovementRepository;

  public CashSessionService(
      CashSessionRepository cashSessionRepository,
      TenantRepository tenantRepository,
      AppUserRepository appUserRepository,
      InvoiceRepository invoiceRepository,
      CashMovementRepository cashMovementRepository) {
    this.cashSessionRepository = cashSessionRepository;
    this.tenantRepository = tenantRepository;
    this.appUserRepository = appUserRepository;
    this.invoiceRepository = invoiceRepository;
    this.cashMovementRepository = cashMovementRepository;
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
  public CashSessionDetailResponse closeSession(
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

    return computeDetail(session);
  }

  @Transactional
  public CashMovementResponse createMovement(
      long tenantId, long userId, CashMovementCreateRequest request) {
    if (request.type() == CashMovementType.TIP_WITHDRAWAL_OUT) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "CASH_MOVEMENT_TYPE_INVALID");
    }
    if (request.amount() == null || request.amount().signum() <= 0) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "CASH_MOVEMENT_AMOUNT_INVALID");
    }
    if (request.reason() == null || request.reason().isBlank()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "CASH_MOVEMENT_REASON_REQUIRED");
    }

    CashSession session =
        cashSessionRepository
            .findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.CONFLICT, "CASH_SESSION_NOT_OPEN"));

    AppUser createdBy = appUserRepository.findById(userId).orElse(null);

    CashMovement movement = new CashMovement();
    movement.setTenant(session.getTenant());
    movement.setCashSession(session);
    movement.setType(request.type());
    movement.setAmount(request.amount());
    movement.setReason(request.reason());
    movement.setCreatedByUser(createdBy);
    movement.setCreatedAt(Instant.now());
    cashMovementRepository.save(movement);

    return toMovementDto(movement);
  }

  @Transactional(readOnly = true)
  public List<CashMovementResponse> listMovements(long tenantId, long sessionId) {
    cashSessionRepository
        .findByIdAndTenant_Id(sessionId, tenantId)
        .orElseThrow(
            () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "CASH_SESSION_NOT_FOUND"));

    return cashMovementRepository
        .findByCashSession_IdAndTenant_IdOrderByCreatedAtAsc(sessionId, tenantId)
        .stream()
        .map(CashSessionService::toMovementDto)
        .toList();
  }

  @Transactional(readOnly = true)
  public PagedCashSessionsResponse listSessions(
      long tenantId,
      Instant fromDate,
      Instant toDate,
      String status,
      String q,
      int page,
      int size) {
    Pageable pageable = PageRequest.of(Math.max(0, page), Math.max(1, Math.min(size, 200)));
    String statusTrimmed = status != null && !status.isBlank() ? status.trim() : null;
    String qTrimmed = q != null && !q.isBlank() ? q.trim() : null;
    Page<CashSession> result =
        cashSessionRepository.findByTenantWithFiltersPaged(
            tenantId, fromDate, toDate, statusTrimmed, qTrimmed, pageable);

    List<CashSessionListItemResponse> content =
        result.getContent().stream().map(this::toListItem).toList();

    return new PagedCashSessionsResponse(
        content,
        result.getNumber(),
        result.getSize(),
        result.getTotalElements(),
        result.getTotalPages());
  }

  @Transactional(readOnly = true)
  public CashSessionDetailResponse getSessionDetail(long tenantId, long sessionId) {
    CashSession session =
        cashSessionRepository
            .findByIdAndTenant_Id(sessionId, tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "CASH_SESSION_NOT_FOUND"));
    return computeDetail(session);
  }

  private CashSessionListItemResponse toListItem(CashSession session) {
    ExpectedCash expected = computeExpectedCash(session.getId());
    BigDecimal countedCash = session.getCountedCashAmount();
    AppUser closedByUser = session.getClosedByUser();

    return new CashSessionListItemResponse(
        session.getId(),
        session.getOpenedAt(),
        session.getClosedAt(),
        session.getOpenedByUser().getEmail(),
        closedByUser != null ? closedByUser.getEmail() : null,
        session.getOpeningCashAmount(),
        countedCash,
        expected.expectedCash(),
        countedCash != null ? countedCash.subtract(expected.expectedCash()) : null,
        session.getClosedAt() == null);
  }

  /**
   * Recomputes a session's full detail from Invoice/InvoicePaymentAllocation/CashMovement — never
   * persisted.
   */
  private CashSessionDetailResponse computeDetail(CashSession session) {
    long sessionId = session.getId();

    BigDecimal totalInvoiced =
        invoiceRepository.sumTotalByCashSessionAndStatus(sessionId, InvoiceStatus.ISSUED);
    long invoiceCount =
        invoiceRepository.countByCashSessionAndStatus(sessionId, InvoiceStatus.ISSUED);

    ExpectedCash expected = computeExpectedCash(sessionId);

    BigDecimal countedCash = session.getCountedCashAmount();
    BigDecimal cashDifference =
        countedCash != null ? countedCash.subtract(expected.expectedCash()) : null;

    List<CashMovementResponse> movements =
        cashMovementRepository
            .findByCashSession_IdAndTenant_IdOrderByCreatedAtAsc(
                sessionId, session.getTenant().getId())
            .stream()
            .map(CashSessionService::toMovementDto)
            .toList();

    AppUser closedByUser = session.getClosedByUser();

    return new CashSessionDetailResponse(
        session.getId(),
        session.getTenant().getId(),
        session.getOpenedAt(),
        session.getOpenedByUser().getEmail(),
        session.getClosedAt(),
        closedByUser != null ? closedByUser.getEmail() : null,
        session.getOpeningCashAmount(),
        countedCash,
        expected.expectedCash(),
        cashDifference,
        totalInvoiced,
        (int) invoiceCount,
        expected.paymentSummary(),
        movements,
        session.getClosedAt() == null);
  }

  /**
   * Cash-payment sales total (unchanged pre-feature calculation) adjusted by manual ingreso/egreso
   * movements and auto-linked tip withdrawals for the session.
   */
  private ExpectedCash computeExpectedCash(long sessionId) {
    List<Object[]> paymentRows = cashSessionRepository.sumPaymentsByMethodForSession(sessionId);
    List<CashSessionDetailResponse.PaymentMethodSummary> paymentSummary = new ArrayList<>();
    BigDecimal expectedCash = BigDecimal.ZERO;
    for (Object[] row : paymentRows) {
      String method = String.valueOf(row[0]);
      BigDecimal amount = (BigDecimal) row[1];
      paymentSummary.add(new CashSessionDetailResponse.PaymentMethodSummary(method, amount));
      if ("CASH".equals(method)) {
        expectedCash = amount;
      }
    }

    for (Object[] row : cashSessionRepository.sumMovementsByTypeForSession(sessionId)) {
      String type = String.valueOf(row[0]);
      BigDecimal amount = (BigDecimal) row[1];
      switch (type) {
        case "MANUAL_IN" -> expectedCash = expectedCash.add(amount);
        case "MANUAL_OUT", "TIP_WITHDRAWAL_OUT" -> expectedCash = expectedCash.subtract(amount);
        default -> {}
      }
    }

    return new ExpectedCash(expectedCash, paymentSummary);
  }

  private record ExpectedCash(
      BigDecimal expectedCash,
      List<CashSessionDetailResponse.PaymentMethodSummary> paymentSummary) {}

  private static CashMovementResponse toMovementDto(CashMovement m) {
    AppUser createdBy = m.getCreatedByUser();
    return new CashMovementResponse(
        m.getId(),
        m.getCashSession().getId(),
        m.getType(),
        m.getAmount(),
        m.getReason(),
        createdBy != null ? createdBy.getEmail() : null,
        m.getCreatedAt(),
        m.getTipWithdrawalId());
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
