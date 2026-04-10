package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.CashSession;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.CashSessionRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.CashSessionOpenRequest;
import com.cursorpoc.backend.web.dto.CashSessionResponse;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

@ExtendWith(MockitoExtension.class)
class CashSessionServiceTest {

  @Mock private CashSessionRepository cashSessionRepository;
  @Mock private TenantRepository tenantRepository;
  @Mock private AppUserRepository appUserRepository;
  @Mock private InvoiceRepository invoiceRepository;

  @InjectMocks private CashSessionService service;

  private Tenant tenant;
  private AppUser user;

  @BeforeEach
  void setUp() {
    tenant = new Tenant();
    tenant.setId(1L);
    tenant.setName("Demo");

    user = new AppUser();
    user.setId(10L);
    user.setEmail("admin@demo.com");
    user.setTenant(tenant);
  }

  @Test
  void getCurrentSession_returnsEmptyWhenNoOpenSession() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.empty());

    Optional<CashSessionResponse> result = service.getCurrentSession(1L);

    assertThat(result).isEmpty();
  }

  @Test
  void getCurrentSession_returnsOpenSession() {
    CashSession session = buildSession(1L, BigDecimal.TEN);
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(session));

    Optional<CashSessionResponse> result = service.getCurrentSession(1L);

    assertThat(result).isPresent();
    CashSessionResponse dto = result.get();
    assertThat(dto.id()).isEqualTo(1L);
    assertThat(dto.openingCashAmount()).isEqualByComparingTo(BigDecimal.TEN);
    assertThat(dto.isOpen()).isTrue();
    assertThat(dto.openedByEmail()).isEqualTo("admin@demo.com");
  }

  @Test
  void openSession_persistsNewSession() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.empty());
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    when(appUserRepository.findById(10L)).thenReturn(Optional.of(user));
    when(cashSessionRepository.save(any(CashSession.class)))
        .thenAnswer(
            inv -> {
              CashSession s = inv.getArgument(0);
              s.setId(99L);
              return s;
            });

    var request = new CashSessionOpenRequest(new BigDecimal("50000.00"));
    CashSessionResponse result = service.openSession(1L, 10L, request);

    assertThat(result.id()).isEqualTo(99L);
    assertThat(result.tenantId()).isEqualTo(1L);
    assertThat(result.openedByUserId()).isEqualTo(10L);
    assertThat(result.openedByEmail()).isEqualTo("admin@demo.com");
    assertThat(result.openingCashAmount()).isEqualByComparingTo(new BigDecimal("50000.00"));
    assertThat(result.isOpen()).isTrue();

    ArgumentCaptor<CashSession> captor = ArgumentCaptor.forClass(CashSession.class);
    verify(cashSessionRepository).save(captor.capture());
    assertThat(captor.getValue().getOpenedAt()).isNotNull();
    assertThat(captor.getValue().getOpeningCashAmount())
        .isEqualByComparingTo(new BigDecimal("50000.00"));
  }

  @Test
  void openSession_throwsConflictWhenSessionAlreadyOpen() {
    CashSession existing = buildSession(5L, BigDecimal.ONE);
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(existing));

    var request = new CashSessionOpenRequest(new BigDecimal("1000.00"));
    assertThatThrownBy(() -> service.openSession(1L, 10L, request))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex -> {
              ResponseStatusException rse = (ResponseStatusException) ex;
              assertThat(rse.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
              assertThat(rse.getReason()).isEqualTo("CASH_SESSION_ALREADY_OPEN");
            });
  }

  @Test
  void openSession_throwsNotFoundWhenTenantMissing() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.empty());
    when(tenantRepository.findById(1L)).thenReturn(Optional.empty());

    var request = new CashSessionOpenRequest(BigDecimal.TEN);
    assertThatThrownBy(() -> service.openSession(1L, 10L, request))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex -> {
              ResponseStatusException rse = (ResponseStatusException) ex;
              assertThat(rse.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
              assertThat(rse.getReason()).isEqualTo("TENANT_NOT_FOUND");
            });
  }

  @Test
  void openSession_throwsNotFoundWhenUserMissing() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.empty());
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    when(appUserRepository.findById(10L)).thenReturn(Optional.empty());

    var request = new CashSessionOpenRequest(BigDecimal.TEN);
    assertThatThrownBy(() -> service.openSession(1L, 10L, request))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex -> {
              ResponseStatusException rse = (ResponseStatusException) ex;
              assertThat(rse.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
              assertThat(rse.getReason()).isEqualTo("USER_NOT_FOUND");
            });
  }

  private CashSession buildSession(long id, BigDecimal amount) {
    CashSession s = new CashSession();
    s.setId(id);
    s.setTenant(tenant);
    s.setOpenedByUser(user);
    s.setOpenedAt(Instant.now());
    s.setOpeningCashAmount(amount);
    return s;
  }
}
