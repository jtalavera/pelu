package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

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
import com.cursorpoc.backend.web.dto.CashSessionOpenRequest;
import com.cursorpoc.backend.web.dto.CashSessionResponse;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
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
  @Mock private CashMovementRepository cashMovementRepository;

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

  @Test
  void closeSession_withNoMovements_matchesPreFeatureCalculation() {
    CashSession session = buildSession(7L, new BigDecimal("100000.00"));
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(session));
    when(appUserRepository.findById(10L)).thenReturn(Optional.of(user));
    when(invoiceRepository.sumTotalByCashSessionAndStatus(7L, InvoiceStatus.ISSUED))
        .thenReturn(new BigDecimal("50000.00"));
    when(invoiceRepository.countByCashSessionAndStatus(7L, InvoiceStatus.ISSUED)).thenReturn(3L);
    when(cashSessionRepository.sumPaymentsByMethodForSession(7L))
        .thenReturn(singleRow("CASH", new BigDecimal("30000.00")));
    when(cashSessionRepository.sumMovementsByTypeForSession(7L)).thenReturn(List.of());
    when(cashMovementRepository.findByCashSession_IdAndTenant_IdOrderByCreatedAtAsc(7L, 1L))
        .thenReturn(List.of());

    var request = new CashSessionCloseRequest(new BigDecimal("30000.00"));
    CashSessionDetailResponse result = service.closeSession(1L, 10L, request);

    assertThat(result.expectedCashAmount()).isEqualByComparingTo("30000.00");
    assertThat(result.cashDifference()).isEqualByComparingTo("0.00");
    assertThat(result.totalInvoiced()).isEqualByComparingTo("50000.00");
    assertThat(result.invoiceCount()).isEqualTo(3);
    assertThat(result.movements()).isEmpty();
    assertThat(result.isOpen()).isFalse();
  }

  @Test
  void closeSession_withManualAndTipWithdrawalMovements_adjustsExpectedCash() {
    CashSession session = buildSession(7L, new BigDecimal("100000.00"));
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(session));
    when(appUserRepository.findById(10L)).thenReturn(Optional.of(user));
    when(invoiceRepository.sumTotalByCashSessionAndStatus(7L, InvoiceStatus.ISSUED))
        .thenReturn(new BigDecimal("50000.00"));
    when(invoiceRepository.countByCashSessionAndStatus(7L, InvoiceStatus.ISSUED)).thenReturn(3L);
    when(cashSessionRepository.sumPaymentsByMethodForSession(7L))
        .thenReturn(singleRow("CASH", new BigDecimal("30000.00")));
    when(cashSessionRepository.sumMovementsByTypeForSession(7L))
        .thenReturn(
            List.of(
                new Object[] {"MANUAL_IN", new BigDecimal("10000.00")},
                new Object[] {"MANUAL_OUT", new BigDecimal("5000.00")},
                new Object[] {"TIP_WITHDRAWAL_OUT", new BigDecimal("2000.00")}));
    when(cashMovementRepository.findByCashSession_IdAndTenant_IdOrderByCreatedAtAsc(7L, 1L))
        .thenReturn(List.of());

    // expected = 30000 (cash sales) + 10000 (ingreso) - 5000 (egreso) - 2000 (retiro propina)
    var request = new CashSessionCloseRequest(new BigDecimal("33000.00"));
    CashSessionDetailResponse result = service.closeSession(1L, 10L, request);

    assertThat(result.expectedCashAmount()).isEqualByComparingTo("33000.00");
    assertThat(result.cashDifference()).isEqualByComparingTo("0.00");
  }

  @Test
  void closeSession_throwsConflictWhenNoSessionOpen() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.empty());

    var request = new CashSessionCloseRequest(BigDecimal.TEN);
    assertThatThrownBy(() -> service.closeSession(1L, 10L, request))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex -> {
              ResponseStatusException rse = (ResponseStatusException) ex;
              assertThat(rse.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
              assertThat(rse.getReason()).isEqualTo("CASH_SESSION_NOT_OPEN");
            });
  }

  @Test
  void createMovement_persistsManualIngreso() {
    CashSession session = buildSession(7L, BigDecimal.TEN);
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(session));
    when(appUserRepository.findById(10L)).thenReturn(Optional.of(user));
    when(cashMovementRepository.save(any(CashMovement.class)))
        .thenAnswer(
            inv -> {
              CashMovement m = inv.getArgument(0);
              m.setId(55L);
              return m;
            });

    var request =
        new CashMovementCreateRequest(
            CashMovementType.MANUAL_IN, new BigDecimal("5000.00"), "Depósito al banco");
    CashMovementResponse result = service.createMovement(1L, 10L, request);

    assertThat(result.id()).isEqualTo(55L);
    assertThat(result.type()).isEqualTo(CashMovementType.MANUAL_IN);
    assertThat(result.amount()).isEqualByComparingTo("5000.00");
    assertThat(result.reason()).isEqualTo("Depósito al banco");
    assertThat(result.createdByEmail()).isEqualTo("admin@demo.com");

    ArgumentCaptor<CashMovement> captor = ArgumentCaptor.forClass(CashMovement.class);
    verify(cashMovementRepository).save(captor.capture());
    assertThat(captor.getValue().getCashSession()).isEqualTo(session);
  }

  @Test
  void createMovement_rejectsNonPositiveAmount() {
    var request =
        new CashMovementCreateRequest(CashMovementType.MANUAL_IN, BigDecimal.ZERO, "Motivo");
    assertThatThrownBy(() -> service.createMovement(1L, 10L, request))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex -> {
              ResponseStatusException rse = (ResponseStatusException) ex;
              assertThat(rse.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
              assertThat(rse.getReason()).isEqualTo("CASH_MOVEMENT_AMOUNT_INVALID");
            });
    verify(cashSessionRepository, never())
        .findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(anyLong());
  }

  @Test
  void createMovement_rejectsBlankReason() {
    var request = new CashMovementCreateRequest(CashMovementType.MANUAL_OUT, BigDecimal.TEN, "   ");
    assertThatThrownBy(() -> service.createMovement(1L, 10L, request))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex -> {
              ResponseStatusException rse = (ResponseStatusException) ex;
              assertThat(rse.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
              assertThat(rse.getReason()).isEqualTo("CASH_MOVEMENT_REASON_REQUIRED");
            });
  }

  @Test
  void createMovement_rejectsTipWithdrawalTypeDirectly() {
    var request =
        new CashMovementCreateRequest(
            CashMovementType.TIP_WITHDRAWAL_OUT, BigDecimal.TEN, "Motivo");
    assertThatThrownBy(() -> service.createMovement(1L, 10L, request))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex -> {
              ResponseStatusException rse = (ResponseStatusException) ex;
              assertThat(rse.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
              assertThat(rse.getReason()).isEqualTo("CASH_MOVEMENT_TYPE_INVALID");
            });
  }

  @Test
  void createMovement_throwsConflictWhenNoSessionOpen() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.empty());

    var request =
        new CashMovementCreateRequest(CashMovementType.MANUAL_IN, BigDecimal.TEN, "Motivo");
    assertThatThrownBy(() -> service.createMovement(1L, 10L, request))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex -> {
              ResponseStatusException rse = (ResponseStatusException) ex;
              assertThat(rse.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
              assertThat(rse.getReason()).isEqualTo("CASH_SESSION_NOT_OPEN");
            });
    verify(cashMovementRepository, never()).save(any());
  }

  @Test
  void listMovements_throwsNotFoundWhenSessionNotOwnedByTenant() {
    when(cashSessionRepository.findByIdAndTenant_Id(7L, 1L)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.listMovements(1L, 7L))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex -> {
              ResponseStatusException rse = (ResponseStatusException) ex;
              assertThat(rse.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
              assertThat(rse.getReason()).isEqualTo("CASH_SESSION_NOT_FOUND");
            });
  }

  @Test
  void getSessionDetail_forOpenSession_leavesCountedAndDifferenceNull() {
    CashSession session = buildSession(7L, new BigDecimal("100000.00"));
    when(cashSessionRepository.findByIdAndTenant_Id(7L, 1L)).thenReturn(Optional.of(session));
    when(invoiceRepository.sumTotalByCashSessionAndStatus(eq(7L), any()))
        .thenReturn(new BigDecimal("20000.00"));
    when(invoiceRepository.countByCashSessionAndStatus(eq(7L), any())).thenReturn(1L);
    when(cashSessionRepository.sumPaymentsByMethodForSession(7L))
        .thenReturn(singleRow("CASH", new BigDecimal("20000.00")));
    when(cashSessionRepository.sumMovementsByTypeForSession(7L)).thenReturn(List.of());
    when(cashMovementRepository.findByCashSession_IdAndTenant_IdOrderByCreatedAtAsc(7L, 1L))
        .thenReturn(List.of());

    CashSessionDetailResponse result = service.getSessionDetail(1L, 7L);

    assertThat(result.isOpen()).isTrue();
    assertThat(result.countedCashAmount()).isNull();
    assertThat(result.cashDifference()).isNull();
    assertThat(result.expectedCashAmount()).isEqualByComparingTo("20000.00");
  }

  private static List<Object[]> singleRow(String label, BigDecimal amount) {
    List<Object[]> rows = new ArrayList<>();
    rows.add(new Object[] {label, amount});
    return rows;
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
