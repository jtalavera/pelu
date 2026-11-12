package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.CashMovement;
import com.cursorpoc.backend.domain.CashSession;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.InvoiceLateTip;
import com.cursorpoc.backend.domain.ManualTip;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.TipWithdrawal;
import com.cursorpoc.backend.domain.enums.CashMovementType;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.domain.enums.ServiceRecordStatus;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.CashMovementRepository;
import com.cursorpoc.backend.repository.CashSessionRepository;
import com.cursorpoc.backend.repository.InvoiceLateTipRepository;
import com.cursorpoc.backend.repository.InvoiceTipRepository;
import com.cursorpoc.backend.repository.ManualTipRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.ServiceRecordTipRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.repository.TipWithdrawalRepository;
import com.cursorpoc.backend.web.dto.CreateTipWithdrawalResponse;
import com.cursorpoc.backend.web.dto.ManualTipMutationResponse;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;

@ExtendWith(MockitoExtension.class)
class TipsServiceTest {

  @Mock private ServiceRecordTipRepository serviceRecordTipRepository;
  @Mock private InvoiceTipRepository invoiceTipRepository;
  @Mock private TipWithdrawalRepository tipWithdrawalRepository;
  @Mock private ProfessionalRepository professionalRepository;
  @Mock private TenantRepository tenantRepository;
  @Mock private AppUserRepository appUserRepository;
  @Mock private CashSessionRepository cashSessionRepository;
  @Mock private CashMovementRepository cashMovementRepository;
  @Mock private ManualTipRepository manualTipRepository;
  @Mock private InvoiceLateTipRepository invoiceLateTipRepository;

  @InjectMocks private TipsService service;

  private Tenant tenant;
  private AppUser user;
  private Professional professional;

  @BeforeEach
  void setUp() {
    tenant = new Tenant();
    tenant.setId(1L);
    tenant.setName("Demo");

    user = new AppUser();
    user.setId(10L);
    user.setEmail("admin@demo.com");

    professional = new Professional();
    professional.setId(20L);
    professional.setFullName("Ana");
    professional.setActive(true);

    lenient()
        .when(professionalRepository.findByIdAndTenant_Id(20L, 1L))
        .thenReturn(Optional.of(professional));
    lenient()
        .when(serviceRecordTipRepository.sumForProfessional(1L, 20L, ServiceRecordStatus.CLOSED))
        .thenReturn(new BigDecimal("50000.00"));
    lenient()
        .when(invoiceTipRepository.sumForProfessional(1L, 20L, InvoiceStatus.ISSUED))
        .thenReturn(BigDecimal.ZERO);
    lenient().when(tipWithdrawalRepository.sumForProfessional(1L, 20L)).thenReturn(BigDecimal.ZERO);
    lenient().when(manualTipRepository.sumForProfessional(1L, 20L)).thenReturn(BigDecimal.ZERO);
    lenient()
        .when(invoiceLateTipRepository.sumForProfessional(1L, 20L, InvoiceStatus.ISSUED))
        .thenReturn(BigDecimal.ZERO);
    lenient().when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    lenient().when(appUserRepository.findById(10L)).thenReturn(Optional.of(user));
  }

  @Test
  void createWithdrawal_withOpenSession_autoCreatesLinkedCashMovement() {
    CashSession openSession = new CashSession();
    openSession.setId(7L);
    openSession.setTenant(tenant);
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(openSession));
    when(tipWithdrawalRepository.save(any(TipWithdrawal.class)))
        .thenAnswer(
            inv -> {
              TipWithdrawal w = inv.getArgument(0);
              w.setId(99L);
              return w;
            });

    CreateTipWithdrawalResponse response =
        service.createWithdrawal(1L, 10L, 20L, new BigDecimal("5000.00"));

    assertThat(response.newBalance()).isEqualByComparingTo("45000.00");

    ArgumentCaptor<CashMovement> captor = ArgumentCaptor.forClass(CashMovement.class);
    verify(cashMovementRepository).save(captor.capture());
    CashMovement movement = captor.getValue();
    assertThat(movement.getCashSession()).isEqualTo(openSession);
    assertThat(movement.getType()).isEqualTo(CashMovementType.TIP_WITHDRAWAL_OUT);
    assertThat(movement.getAmount()).isEqualByComparingTo("5000.00");
    assertThat(movement.getTipWithdrawalId()).isEqualTo(99L);
    assertThat(movement.getCreatedAt()).isInstanceOf(Instant.class);
  }

  @Test
  void createWithdrawal_withNoRegisterEver_createsNoCashMovement() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.empty());
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNotNullOrderByClosedAtDesc(1L))
        .thenReturn(Optional.empty());

    CreateTipWithdrawalResponse response =
        service.createWithdrawal(1L, 10L, 20L, new BigDecimal("5000.00"));

    assertThat(response.newBalance()).isEqualByComparingTo("45000.00");
    assertThat(response.cashSessionId()).isNull();
    assertThat(response.afterClose()).isFalse();
    verify(cashMovementRepository, never()).save(any());
  }

  @Test
  void createWithdrawal_withNoOpenSession_isRecordedOnTheLastClosedOneAfterClose() {
    CashSession closed = new CashSession();
    closed.setId(5L);
    closed.setTenant(tenant);
    closed.setClosedAt(Instant.now());
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.empty());
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNotNullOrderByClosedAtDesc(1L))
        .thenReturn(Optional.of(closed));
    when(tipWithdrawalRepository.save(any(TipWithdrawal.class)))
        .thenAnswer(
            inv -> {
              TipWithdrawal w = inv.getArgument(0);
              w.setId(98L);
              return w;
            });

    CreateTipWithdrawalResponse response =
        service.createWithdrawal(1L, 10L, 20L, new BigDecimal("5000.00"));

    assertThat(response.cashSessionId()).isEqualTo(5L);
    assertThat(response.afterClose()).isTrue();
    ArgumentCaptor<CashMovement> captor = ArgumentCaptor.forClass(CashMovement.class);
    verify(cashMovementRepository).save(captor.capture());
    assertThat(captor.getValue().getCashSession()).isEqualTo(closed);
    assertThat(captor.getValue().isAfterClose()).isTrue();
    assertThat(captor.getValue().getType()).isEqualTo(CashMovementType.TIP_WITHDRAWAL_OUT);
  }

  // ── Tips left after the invoice was issued (HU-73) ────────────────────────────────────────────

  @Test
  void getBalance_includesTheTipsLeftAfterTheInvoiceWasIssued() {
    when(invoiceLateTipRepository.sumForProfessional(1L, 20L, InvoiceStatus.ISSUED))
        .thenReturn(new BigDecimal("15000.00"));

    // 50.000 from fichas + 15.000 late tips - 0 withdrawn
    assertThat(service.getBalance(1L, 20L).balance()).isEqualByComparingTo("65000.00");
  }

  @Test
  void getReport_listsLateTipsWithTheirPaymentAndCountsOnlyTheLiveOnes() {
    Invoice invoice = new Invoice();
    invoice.setId(30L);
    invoice.setInvoiceNumber(126);
    invoice.setClientDisplayName("María Gómez");
    AppUser creator = new AppUser();
    creator.setId(11L);
    creator.setEmail("ana@demo.com");
    InvoiceLateTip live = new InvoiceLateTip();
    live.setId(1L);
    live.setInvoice(invoice);
    live.setProfessional(professional);
    live.setAmount(new BigDecimal("10000.00"));
    live.setPaymentMethod(com.cursorpoc.backend.domain.enums.PaymentMethod.DEBIT_CARD);
    live.setCardBrand(com.cursorpoc.backend.domain.enums.CardBrand.VISA);
    live.setCreatedBy(creator);
    live.setCreatedAt(Instant.parse("2026-11-12T15:12:00Z"));
    InvoiceLateTip voided = new InvoiceLateTip();
    voided.setId(2L);
    voided.setInvoice(invoice);
    voided.setProfessional(professional);
    voided.setAmount(new BigDecimal("1000.00"));
    voided.setPaymentMethod(com.cursorpoc.backend.domain.enums.PaymentMethod.CASH);
    voided.setCreatedAt(Instant.parse("2026-11-12T15:10:00Z"));
    voided.setVoidedAt(Instant.parse("2026-11-12T15:20:00Z"));
    voided.setVoidReason("Monto mal cargado");
    voided.setVoidedBy(creator);
    when(invoiceLateTipRepository.findForReport(any(), any(), any(), any(), any()))
        .thenReturn(java.util.List.of(live, voided));

    var report =
        service.getReport(
            1L,
            Instant.parse("2026-11-01T00:00:00Z"),
            Instant.parse("2026-11-30T00:00:00Z"),
            java.util.List.of(20L));

    assertThat(report.rows()).hasSize(2);
    var liveRow =
        report.rows().stream()
            .filter(r -> Long.valueOf(1L).equals(r.lateTipId()))
            .findFirst()
            .get();
    assertThat(liveRow.paymentMethod()).isEqualTo("DEBIT_CARD");
    assertThat(liveRow.cardBrand()).isEqualTo("VISA");
    assertThat(liveRow.invoiceNumberFormatted()).isEqualTo("0000126");
    assertThat(liveRow.clientName()).isEqualTo("María Gómez");
    assertThat(liveRow.createdByName()).isEqualTo("ana@demo.com");
    assertThat(liveRow.voided()).isFalse();
    assertThat(liveRow.manualTipId()).isNull();
    var voidedRow =
        report.rows().stream()
            .filter(r -> Long.valueOf(2L).equals(r.lateTipId()))
            .findFirst()
            .get();
    assertThat(voidedRow.voided()).isTrue();
    assertThat(voidedRow.voidReason()).isEqualTo("Monto mal cargado");
    // Only the live late tip counts in the totals.
    assertThat(report.grandTotal()).isEqualByComparingTo("10000.00");
  }

  // ── Manual tips (loaded by the salon administrator) ────────────────────────────────────────────

  private ManualTip savedManualTip(long id, String amount, boolean voided) {
    ManualTip tip = new ManualTip();
    tip.setId(id);
    tip.setTenant(tenant);
    tip.setProfessional(professional);
    tip.setAmount(new BigDecimal(amount));
    tip.setTippedAt(Instant.now().minus(Duration.ofDays(1)));
    tip.setCreatedAt(Instant.now());
    if (voided) {
      tip.setVoidedAt(Instant.now());
    }
    when(manualTipRepository.findByIdAndTenant_Id(id, 1L)).thenReturn(Optional.of(tip));
    return tip;
  }

  private static void assertCode(Runnable call, String code) {
    assertThatThrownBy(call::run)
        .isInstanceOf(ResponseStatusException.class)
        .extracting(e -> ((ResponseStatusException) e).getReason())
        .isEqualTo(code);
  }

  @Test
  void createManualTip_savesTrimmedNoteAndAddsToTheBalance() {
    when(manualTipRepository.sumForProfessional(1L, 20L)).thenReturn(new BigDecimal("20000.00"));
    when(manualTipRepository.save(any(ManualTip.class)))
        .thenAnswer(
            inv -> {
              ManualTip t = inv.getArgument(0);
              t.setId(5L);
              return t;
            });

    ManualTipMutationResponse response =
        service.createManualTip(
            1L,
            10L,
            20L,
            new BigDecimal("20000"),
            Instant.now().minus(Duration.ofHours(2)),
            "  Propina en efectivo  ");

    ArgumentCaptor<ManualTip> captor = ArgumentCaptor.forClass(ManualTip.class);
    verify(manualTipRepository).save(captor.capture());
    assertThat(captor.getValue().getNote()).isEqualTo("Propina en efectivo");
    assertThat(captor.getValue().getCreatedBy()).isEqualTo(user);
    assertThat(response.tip().id()).isEqualTo(5L);
    assertThat(response.tip().voided()).isFalse();
    // 50.000 from fichas + 20.000 manual
    assertThat(response.newBalance()).isEqualByComparingTo("70000.00");
  }

  @Test
  void createManualTip_rejectsInvalidAmountFutureDateAndLongNote() {
    Instant ok = Instant.now().minus(Duration.ofHours(1));
    assertCode(
        () -> service.createManualTip(1L, 10L, 20L, BigDecimal.ZERO, ok, null),
        "MANUAL_TIP_AMOUNT_INVALID");
    assertCode(
        () -> service.createManualTip(1L, 10L, 20L, null, ok, null), "MANUAL_TIP_AMOUNT_INVALID");
    assertCode(
        () -> service.createManualTip(1L, 10L, 20L, BigDecimal.TEN, null, null),
        "MANUAL_TIP_DATE_REQUIRED");
    assertCode(
        () ->
            service.createManualTip(
                1L, 10L, 20L, BigDecimal.TEN, Instant.now().plus(Duration.ofDays(3)), null),
        "MANUAL_TIP_DATE_IN_FUTURE");
    assertCode(
        () -> service.createManualTip(1L, 10L, 20L, BigDecimal.TEN, ok, "x".repeat(201)),
        "MANUAL_TIP_NOTE_TOO_LONG");
    verify(manualTipRepository, never()).save(any());
  }

  @Test
  void createManualTip_forAnInactiveProfessional_isRefused() {
    professional.setActive(false);
    assertCode(
        () ->
            service.createManualTip(
                1L, 10L, 20L, BigDecimal.TEN, Instant.now().minus(Duration.ofHours(1)), null),
        "MANUAL_TIP_PROFESSIONAL_INACTIVE");
  }

  @Test
  void updateManualTip_changesTheFieldsAndKeepsTheBalanceConsistent() {
    ManualTip tip = savedManualTip(5L, "20000", false);
    // balance = 50.000 (fichas) + 20.000 (this manual tip)
    when(manualTipRepository.sumForProfessional(1L, 20L)).thenReturn(new BigDecimal("20000"));

    ManualTipMutationResponse response =
        service.updateManualTip(
            1L, 10L, 5L, new BigDecimal("30000"), Instant.now().minus(Duration.ofHours(3)), "  ");

    assertThat(tip.getAmount()).isEqualByComparingTo("30000");
    assertThat(tip.getNote()).isNull();
    assertThat(tip.getUpdatedBy()).isEqualTo(user);
    assertThat(tip.getUpdatedAt()).isNotNull();
    assertThat(response.newBalance()).isEqualByComparingTo("80000");
  }

  @Test
  void updateManualTip_cannotLeaveTheBalanceBelowWhatWasWithdrawn() {
    savedManualTip(5L, "20000", false);
    when(manualTipRepository.sumForProfessional(1L, 20L)).thenReturn(new BigDecimal("20000"));
    // fichas 50.000 + manual 20.000 - withdrawn 65.000 = 5.000; lowering the manual tip to 10.000
    // would leave -5.000.
    when(tipWithdrawalRepository.sumForProfessional(1L, 20L)).thenReturn(new BigDecimal("65000"));

    assertCode(
        () ->
            service.updateManualTip(
                1L,
                10L,
                5L,
                new BigDecimal("10000"),
                Instant.now().minus(Duration.ofHours(1)),
                null),
        "MANUAL_TIP_EDIT_BELOW_WITHDRAWN");
  }

  @Test
  void updateManualTip_ofAVoidedOrUnknownTip_isRefused() {
    savedManualTip(6L, "1000", true);
    when(manualTipRepository.findByIdAndTenant_Id(404L, 1L)).thenReturn(Optional.empty());
    Instant ok = Instant.now().minus(Duration.ofHours(1));
    assertCode(
        () -> service.updateManualTip(1L, 10L, 6L, BigDecimal.TEN, ok, null),
        "MANUAL_TIP_ALREADY_VOIDED");
    assertCode(
        () -> service.updateManualTip(1L, 10L, 404L, BigDecimal.TEN, ok, null),
        "MANUAL_TIP_NOT_FOUND");
  }

  @Test
  void voidManualTip_keepsTheRowWithWhoAndWhyAndDropsItFromTheBalance() {
    ManualTip tip = savedManualTip(5L, "20000", false);
    when(manualTipRepository.sumForProfessional(1L, 20L)).thenReturn(new BigDecimal("20000"));

    ManualTipMutationResponse response = service.voidManualTip(1L, 10L, 5L, "  Monto mal cargado ");

    assertThat(tip.isVoided()).isTrue();
    assertThat(tip.getVoidReason()).isEqualTo("Monto mal cargado");
    assertThat(tip.getVoidedBy()).isEqualTo(user);
    assertThat(response.tip().voided()).isTrue();
    assertThat(response.tip().voidReason()).isEqualTo("Monto mal cargado");
    // 50.000 (fichas) + 20.000 (manual) - 20.000 (this one, now voided)
    assertThat(response.newBalance()).isEqualByComparingTo("50000");
    verify(manualTipRepository).save(tip);
  }

  @Test
  void voidManualTip_requiresAReasonAndIsRefusedWhenAlreadyVoidedOrAlreadyWithdrawn() {
    savedManualTip(5L, "20000", false);
    assertCode(() -> service.voidManualTip(1L, 10L, 5L, "  "), "MANUAL_TIP_VOID_REASON_REQUIRED");
    assertCode(() -> service.voidManualTip(1L, 10L, 5L, null), "MANUAL_TIP_VOID_REASON_REQUIRED");
    assertCode(
        () -> service.voidManualTip(1L, 10L, 5L, "x".repeat(201)),
        "MANUAL_TIP_VOID_REASON_TOO_LONG");

    // fichas 50.000 + manual 20.000 - withdrawn 65.000 = 5.000 < 20.000: the money is gone.
    when(manualTipRepository.sumForProfessional(1L, 20L)).thenReturn(new BigDecimal("20000"));
    when(tipWithdrawalRepository.sumForProfessional(1L, 20L)).thenReturn(new BigDecimal("65000"));
    assertCode(
        () -> service.voidManualTip(1L, 10L, 5L, "Error"), "MANUAL_TIP_VOID_EXCEEDS_BALANCE");

    savedManualTip(7L, "1000", true);
    assertCode(() -> service.voidManualTip(1L, 10L, 7L, "Error"), "MANUAL_TIP_ALREADY_VOIDED");
  }
}
