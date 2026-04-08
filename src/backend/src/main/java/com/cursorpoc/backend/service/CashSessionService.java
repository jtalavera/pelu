package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.CashSession;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.CashSessionRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.CashSessionOpenRequest;
import com.cursorpoc.backend.web.dto.CashSessionResponse;
import java.time.Instant;
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

  public CashSessionService(
      CashSessionRepository cashSessionRepository,
      TenantRepository tenantRepository,
      AppUserRepository appUserRepository) {
    this.cashSessionRepository = cashSessionRepository;
    this.tenantRepository = tenantRepository;
    this.appUserRepository = appUserRepository;
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
