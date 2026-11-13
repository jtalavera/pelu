package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.domain.AppUser;
import com.cursorpoc.backend.domain.CashSession;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.InvoiceLateTip;
import com.cursorpoc.backend.domain.InvoiceTip;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.CardBrand;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.domain.enums.PaymentMethod;
import com.cursorpoc.backend.repository.AppUserRepository;
import com.cursorpoc.backend.repository.CashSessionRepository;
import com.cursorpoc.backend.repository.InvoiceLateTipRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.InvoiceTipItemResponse;
import com.cursorpoc.backend.web.dto.InvoiceTipsResponse;
import com.cursorpoc.backend.web.dto.LateTipRequest;
import com.cursorpoc.backend.web.dto.ProfessionalTipBalanceResponse;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
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
class InvoiceLateTipServiceTest {

  @Mock private InvoiceRepository invoiceRepository;
  @Mock private InvoiceLateTipRepository invoiceLateTipRepository;
  @Mock private ProfessionalRepository professionalRepository;
  @Mock private CashSessionRepository cashSessionRepository;
  @Mock private TenantRepository tenantRepository;
  @Mock private AppUserRepository appUserRepository;
  @Mock private TipsService tipsService;

  @InjectMocks private InvoiceLateTipService service;

  private Tenant tenant;
  private AppUser user;
  private Professional laura;
  private Invoice invoice;
  private CashSession openSession;

  @BeforeEach
  void setUp() {
    tenant = new Tenant();
    tenant.setId(1L);

    user = new AppUser();
    user.setId(10L);
    user.setEmail("ana@demo.com");

    laura = new Professional();
    laura.setId(20L);
    laura.setFullName("Laura Benítez");
    laura.setActive(true);

    invoice = new Invoice();
    invoice.setId(30L);
    invoice.setTenant(tenant);
    invoice.setStatus(InvoiceStatus.ISSUED);

    openSession = new CashSession();
    openSession.setId(7L);
    openSession.setTenant(tenant);
    openSession.setOpenedAt(Instant.parse("2026-11-12T11:00:00Z"));

    lenient()
        .when(invoiceRepository.findByIdAndTenant_Id(30L, 1L))
        .thenReturn(Optional.of(invoice));
    lenient()
        .when(professionalRepository.findByIdAndTenant_Id(20L, 1L))
        .thenReturn(Optional.of(laura));
    lenient()
        .when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(openSession));
    lenient().when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    lenient().when(appUserRepository.findById(10L)).thenReturn(Optional.of(user));
    lenient().when(invoiceLateTipRepository.findByInvoice(30L, 1L)).thenReturn(List.of());
  }

  private static LateTipRequest cashTip(String amount) {
    return new LateTipRequest(20L, new BigDecimal(amount), "CASH", null, null);
  }

  private static void assertCode(Runnable call, String code) {
    assertThatThrownBy(call::run)
        .isInstanceOf(ResponseStatusException.class)
        .extracting(e -> ((ResponseStatusException) e).getReason())
        .isEqualTo(code);
  }

  // ── create ──────────────────────────────────────────────────────────────────────────────────

  @Test
  void create_savesEachTipInTheOpenRegisterWithItsOwnPaymentMethod() {
    LateTipRequest card =
        new LateTipRequest(20L, new BigDecimal("5000"), "DEBIT_CARD", "visa", null);

    service.create(1L, 10L, 30L, List.of(cashTip("10000"), card));

    @SuppressWarnings("unchecked")
    ArgumentCaptor<List<InvoiceLateTip>> captor = ArgumentCaptor.forClass(List.class);
    verify(invoiceLateTipRepository).saveAll(captor.capture());
    List<InvoiceLateTip> saved = captor.getValue();
    assertThat(saved).hasSize(2);
    InvoiceLateTip first = saved.get(0);
    assertThat(first.getCashSession()).isSameAs(openSession);
    assertThat(first.getInvoice()).isSameAs(invoice);
    assertThat(first.getProfessional()).isSameAs(laura);
    assertThat(first.getAmount()).isEqualByComparingTo("10000.00");
    assertThat(first.getPaymentMethod()).isEqualTo(PaymentMethod.CASH);
    assertThat(first.getCardBrand()).isNull();
    assertThat(first.getCreatedBy()).isSameAs(user);
    assertThat(first.getCreatedAt()).isNotNull();
    InvoiceLateTip second = saved.get(1);
    assertThat(second.getPaymentMethod()).isEqualTo(PaymentMethod.DEBIT_CARD);
    assertThat(second.getCardBrand()).isEqualTo(CardBrand.VISA);
  }

  @Test
  void create_otherCardBrandKeepsItsTrimmedDescription() {
    LateTipRequest card =
        new LateTipRequest(20L, new BigDecimal("5000"), "CREDIT_CARD", "OTHER", "  Union Pay ");

    service.create(1L, 10L, 30L, List.of(card));

    @SuppressWarnings("unchecked")
    ArgumentCaptor<List<InvoiceLateTip>> captor = ArgumentCaptor.forClass(List.class);
    verify(invoiceLateTipRepository).saveAll(captor.capture());
    assertThat(captor.getValue().get(0).getCardBrandOtherDescription()).isEqualTo("Union Pay");
  }

  @Test
  void create_withoutAnOpenCashRegister_isRefused() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.empty());

    assertCode(
        () -> service.create(1L, 10L, 30L, List.of(cashTip("10000"))),
        "LATE_TIP_NO_OPEN_CASH_SESSION");
    verify(invoiceLateTipRepository, never()).saveAll(any());
  }

  @Test
  void create_forAVoidedInvoice_isRefused() {
    invoice.setStatus(InvoiceStatus.VOIDED);

    assertCode(
        () -> service.create(1L, 10L, 30L, List.of(cashTip("10000"))),
        "LATE_TIP_INVOICE_NOT_ISSUED");
  }

  @Test
  void create_forAnUnknownInvoice_isRefused() {
    assertCode(() -> service.create(1L, 10L, 999L, List.of(cashTip("10000"))), "INVOICE_NOT_FOUND");
  }

  @Test
  void create_withNoTips_isRefused() {
    assertCode(() -> service.create(1L, 10L, 30L, List.of()), "LATE_TIP_REQUIRED");
    assertCode(() -> service.create(1L, 10L, 30L, null), "LATE_TIP_REQUIRED");
  }

  @Test
  void create_rejectsAnInvalidAmount() {
    assertCode(
        () -> service.create(1L, 10L, 30L, List.of(cashTip("0"))), "LATE_TIP_AMOUNT_INVALID");
    assertCode(
        () ->
            service.create(
                1L, 10L, 30L, List.of(new LateTipRequest(20L, null, "CASH", null, null))),
        "LATE_TIP_AMOUNT_INVALID");
  }

  @Test
  void create_forAnInactiveProfessional_isRefused() {
    laura.setActive(false);

    assertCode(
        () -> service.create(1L, 10L, 30L, List.of(cashTip("10000"))),
        "LATE_TIP_PROFESSIONAL_INACTIVE");
  }

  @Test
  void create_forAProfessionalOfAnotherTenant_isRefused() {
    LateTipRequest foreign = new LateTipRequest(77L, new BigDecimal("1000"), "CASH", null, null);

    assertCode(() -> service.create(1L, 10L, 30L, List.of(foreign)), "PROFESSIONAL_NOT_FOUND");
  }

  @Test
  void create_rejectsAnUnknownPaymentMethod() {
    LateTipRequest bad = new LateTipRequest(20L, new BigDecimal("1000"), "BITCOIN", null, null);

    assertCode(() -> service.create(1L, 10L, 30L, List.of(bad)), "INVALID_PAYMENT_METHOD");
  }

  @Test
  void create_cardPaymentsNeedTheBrand() {
    LateTipRequest noBrand =
        new LateTipRequest(20L, new BigDecimal("1000"), "DEBIT_CARD", null, null);
    LateTipRequest badBrand =
        new LateTipRequest(20L, new BigDecimal("1000"), "CREDIT_CARD", "NOPE", null);
    LateTipRequest otherWithoutText =
        new LateTipRequest(20L, new BigDecimal("1000"), "CREDIT_CARD", "OTHER", "  ");
    LateTipRequest otherTooLong =
        new LateTipRequest(20L, new BigDecimal("1000"), "CREDIT_CARD", "OTHER", "x".repeat(101));

    assertCode(() -> service.create(1L, 10L, 30L, List.of(noBrand)), "CARD_BRAND_REQUIRED");
    assertCode(() -> service.create(1L, 10L, 30L, List.of(badBrand)), "CARD_BRAND_REQUIRED");
    assertCode(
        () -> service.create(1L, 10L, 30L, List.of(otherWithoutText)),
        "CARD_BRAND_OTHER_DESCRIPTION_REQUIRED");
    assertCode(
        () -> service.create(1L, 10L, 30L, List.of(otherTooLong)),
        "CARD_BRAND_OTHER_DESCRIPTION_TOO_LONG");
  }

  @Test
  void create_aBadTipSavesNothingEvenIfTheOnesBeforeItWereValid() {
    LateTipRequest bad = new LateTipRequest(20L, new BigDecimal("0"), "CASH", null, null);

    assertCode(
        () -> service.create(1L, 10L, 30L, List.of(cashTip("10000"), bad)),
        "LATE_TIP_AMOUNT_INVALID");
    verify(invoiceLateTipRepository, never()).saveAll(any());
    verify(invoiceLateTipRepository, never()).save(any());
  }

  // ── list ────────────────────────────────────────────────────────────────────────────────────

  @Test
  void list_mergesIssuanceAndLateTipsAndSkipsVoidedOnesInTheTotal() {
    InvoiceTip issuance = new InvoiceTip();
    issuance.setInvoice(invoice);
    issuance.setProfessional(laura);
    issuance.setAmount(new BigDecimal("10000.00"));
    invoice.getTips().add(issuance);
    InvoiceLateTip live = lateTip(1L, "5000.00", false);
    InvoiceLateTip voided = lateTip(2L, "2000.00", true);
    when(invoiceLateTipRepository.findByInvoice(30L, 1L)).thenReturn(List.of(live, voided));

    InvoiceTipsResponse response = service.list(1L, 30L);

    assertThat(response.invoiceId()).isEqualTo(30L);
    assertThat(response.total()).isEqualByComparingTo("15000.00");
    assertThat(response.openCashSessionId()).isEqualTo(7L);
    assertThat(response.openCashSessionOpenedAt()).isEqualTo(openSession.getOpenedAt());
    assertThat(response.items())
        .extracting(InvoiceTipItemResponse::source)
        .containsExactly("ISSUANCE", "LATE", "LATE");
    InvoiceTipItemResponse late = response.items().get(1);
    assertThat(late.id()).isEqualTo(1L);
    assertThat(late.paymentMethod()).isEqualTo("DEBIT_CARD");
    assertThat(late.cardBrand()).isEqualTo("VISA");
    assertThat(late.createdByName()).isEqualTo("ana@demo.com");
    assertThat(late.cashSessionOpen()).isTrue();
    assertThat(response.items().get(2).voided()).isTrue();
    assertThat(response.items().get(0).paymentMethod()).isNull();
  }

  @Test
  void list_withoutAnOpenRegisterReportsNone() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.empty());

    InvoiceTipsResponse response = service.list(1L, 30L);

    assertThat(response.openCashSessionId()).isNull();
    assertThat(response.openCashSessionOpenedAt()).isNull();
  }

  // ── void ────────────────────────────────────────────────────────────────────────────────────

  private InvoiceLateTip lateTip(long id, String amount, boolean voided) {
    InvoiceLateTip t = new InvoiceLateTip();
    t.setId(id);
    t.setTenant(tenant);
    t.setInvoice(invoice);
    t.setProfessional(laura);
    t.setCashSession(openSession);
    t.setAmount(new BigDecimal(amount));
    t.setPaymentMethod(PaymentMethod.DEBIT_CARD);
    t.setCardBrand(CardBrand.VISA);
    t.setCreatedBy(user);
    t.setCreatedAt(Instant.parse("2026-11-12T15:12:00Z"));
    if (voided) {
      t.setVoidedAt(Instant.parse("2026-11-12T15:30:00Z"));
      t.setVoidedBy(user);
      t.setVoidReason("Monto mal cargado");
    }
    return t;
  }

  private void balanceIs(String balance) {
    lenient()
        .when(tipsService.getBalance(1L, 20L))
        .thenReturn(new ProfessionalTipBalanceResponse(20L, "Laura", new BigDecimal(balance)));
  }

  @Test
  void voidTip_marksItVoidedWithWhoAndWhy() {
    InvoiceLateTip tip = lateTip(1L, "5000.00", false);
    when(invoiceLateTipRepository.findByIdAndTenant(1L, 1L)).thenReturn(Optional.of(tip));
    when(invoiceLateTipRepository.findByInvoice(30L, 1L)).thenReturn(List.of(tip));
    balanceIs("20000");

    InvoiceTipsResponse response = service.voidTip(1L, 10L, 1L, "  Monto mal cargado ");

    assertThat(tip.isVoided()).isTrue();
    assertThat(tip.getVoidReason()).isEqualTo("Monto mal cargado");
    assertThat(tip.getVoidedBy()).isSameAs(user);
    verify(invoiceLateTipRepository).save(tip);
    assertThat(response.items().get(0).voided()).isTrue();
    assertThat(response.total()).isEqualByComparingTo("0");
  }

  @Test
  void voidTip_requiresAReasonOfAtMost200Characters() {
    InvoiceLateTip tip = lateTip(1L, "5000.00", false);
    when(invoiceLateTipRepository.findByIdAndTenant(1L, 1L)).thenReturn(Optional.of(tip));

    assertCode(() -> service.voidTip(1L, 10L, 1L, null), "LATE_TIP_VOID_REASON_REQUIRED");
    assertCode(() -> service.voidTip(1L, 10L, 1L, "   "), "LATE_TIP_VOID_REASON_REQUIRED");
    assertCode(
        () -> service.voidTip(1L, 10L, 1L, "x".repeat(201)), "LATE_TIP_VOID_REASON_TOO_LONG");
    assertThat(tip.isVoided()).isFalse();
  }

  @Test
  void voidTip_anAlreadyVoidedOneOrAnUnknownOne_isRefused() {
    InvoiceLateTip voided = lateTip(1L, "5000.00", true);
    when(invoiceLateTipRepository.findByIdAndTenant(1L, 1L)).thenReturn(Optional.of(voided));

    assertCode(() -> service.voidTip(1L, 10L, 1L, "otra vez"), "LATE_TIP_ALREADY_VOIDED");
    assertCode(() -> service.voidTip(1L, 10L, 404L, "no existe"), "LATE_TIP_NOT_FOUND");
  }

  @Test
  void voidTip_whenTheRegisterItEnteredIsClosed_isRefused() {
    InvoiceLateTip tip = lateTip(1L, "5000.00", false);
    openSession.setClosedAt(Instant.parse("2026-11-12T20:00:00Z"));
    when(invoiceLateTipRepository.findByIdAndTenant(1L, 1L)).thenReturn(Optional.of(tip));

    assertCode(() -> service.voidTip(1L, 10L, 1L, "Error"), "LATE_TIP_CASH_SESSION_CLOSED");
    assertThat(tip.isVoided()).isFalse();
  }

  @Test
  void voidTip_whenTheProfessionalAlreadyWithdrewThatMoney_isRefused() {
    InvoiceLateTip tip = lateTip(1L, "5000.00", false);
    when(invoiceLateTipRepository.findByIdAndTenant(1L, 1L)).thenReturn(Optional.of(tip));
    balanceIs("3000");

    assertCode(() -> service.voidTip(1L, 10L, 1L, "Error"), "LATE_TIP_VOID_EXCEEDS_BALANCE");
    assertThat(tip.isVoided()).isFalse();
    verify(invoiceLateTipRepository, never()).save(any());
  }
}
