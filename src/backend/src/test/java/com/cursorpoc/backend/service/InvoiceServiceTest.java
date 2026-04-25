package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.domain.CashSession;
import com.cursorpoc.backend.domain.FiscalStamp;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.DiscountType;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.repository.CashSessionRepository;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.FiscalStampRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.InvoiceCreateRequest;
import com.cursorpoc.backend.web.dto.InvoiceLineRequest;
import com.cursorpoc.backend.web.dto.InvoicePaymentAllocationRequest;
import com.cursorpoc.backend.web.dto.InvoiceResponse;
import com.cursorpoc.backend.web.dto.InvoiceVoidRequest;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

@ExtendWith(MockitoExtension.class)
class InvoiceServiceTest {

  @Mock private InvoiceRepository invoiceRepository;
  @Mock private CashSessionRepository cashSessionRepository;
  @Mock private FiscalStampRepository fiscalStampRepository;
  @Mock private ClientRepository clientRepository;
  @Mock private TenantRepository tenantRepository;
  @Mock private SalonServiceRepository salonServiceRepository;

  @InjectMocks private InvoiceService invoiceService;

  private Tenant tenant;
  private CashSession openSession;
  private FiscalStamp activeStamp;

  @BeforeEach
  void setUp() {
    tenant = new Tenant();
    tenant.setId(1L);
    tenant.setName("Demo");

    openSession = new CashSession();
    openSession.setId(10L);
    openSession.setTenant(tenant);

    activeStamp = new FiscalStamp();
    activeStamp.setId(5L);
    activeStamp.setTenant(tenant);
    activeStamp.setStampNumber("12345678");
    activeStamp.setValidFrom(LocalDate.now().minusDays(10));
    activeStamp.setValidUntil(LocalDate.now().plusDays(365));
    activeStamp.setRangeFrom(1);
    activeStamp.setRangeTo(9999999);
    activeStamp.setNextEmissionNumber(1);
    activeStamp.setActive(true);
  }

  @Test
  void issueInvoice_success_singlePaymentCash() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(openSession));
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L))
        .thenReturn(Optional.of(activeStamp));
    when(fiscalStampRepository.lockByIdAndTenantId(5L, 1L)).thenReturn(Optional.of(activeStamp));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    when(invoiceRepository.save(any(Invoice.class)))
        .thenAnswer(
            inv -> {
              Invoice i = inv.getArgument(0);
              i.setId(100L);
              return i;
            });

    var line = new InvoiceLineRequest(null, "Haircut", 1, new BigDecimal("50000.00"));
    var payment = new InvoicePaymentAllocationRequest("CASH", new BigDecimal("50000.00"));
    var request =
        new InvoiceCreateRequest(null, null, null, null, null, List.of(line), List.of(payment));

    InvoiceResponse result = invoiceService.issueInvoice(1L, request);

    assertThat(result.id()).isEqualTo(100L);
    assertThat(result.invoiceNumber()).isEqualTo(1);
    assertThat(result.invoiceNumberFormatted()).isEqualTo("0000001");
    assertThat(result.subtotal()).isEqualByComparingTo(new BigDecimal("50000.00"));
    assertThat(result.total()).isEqualByComparingTo(new BigDecimal("50000.00"));
    assertThat(result.status()).isEqualTo(InvoiceStatus.ISSUED.name());
    assertThat(result.discountType()).isEqualTo(DiscountType.NONE.name());
    assertThat(result.lines()).hasSize(1);
    assertThat(result.payments()).hasSize(1);

    // Verify stamp incremented
    assertThat(activeStamp.getNextEmissionNumber()).isEqualTo(2);
    assertThat(activeStamp.isLockedAfterInvoice()).isTrue();
  }

  @Test
  void issueInvoice_withFixedDiscount() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(openSession));
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L))
        .thenReturn(Optional.of(activeStamp));
    when(fiscalStampRepository.lockByIdAndTenantId(5L, 1L)).thenReturn(Optional.of(activeStamp));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    when(invoiceRepository.save(any(Invoice.class))).thenAnswer(inv -> inv.getArgument(0));

    var line = new InvoiceLineRequest(null, "Color", 1, new BigDecimal("100000.00"));
    var payment = new InvoicePaymentAllocationRequest("DEBIT_CARD", new BigDecimal("90000.00"));
    var request =
        new InvoiceCreateRequest(
            null, null, null, "FIXED", new BigDecimal("10000.00"), List.of(line), List.of(payment));

    InvoiceResponse result = invoiceService.issueInvoice(1L, request);

    assertThat(result.subtotal()).isEqualByComparingTo(new BigDecimal("100000.00"));
    assertThat(result.discountType()).isEqualTo(DiscountType.FIXED.name());
    assertThat(result.total()).isEqualByComparingTo(new BigDecimal("90000.00"));
  }

  @Test
  void issueInvoice_withPercentDiscount() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(openSession));
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L))
        .thenReturn(Optional.of(activeStamp));
    when(fiscalStampRepository.lockByIdAndTenantId(5L, 1L)).thenReturn(Optional.of(activeStamp));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    when(invoiceRepository.save(any(Invoice.class))).thenAnswer(inv -> inv.getArgument(0));

    var line = new InvoiceLineRequest(null, "Mani", 1, new BigDecimal("200000.00"));
    var payment = new InvoicePaymentAllocationRequest("CASH", new BigDecimal("180000.00"));
    var request =
        new InvoiceCreateRequest(
            null, null, null, "PERCENT", new BigDecimal("10"), List.of(line), List.of(payment));

    InvoiceResponse result = invoiceService.issueInvoice(1L, request);

    assertThat(result.total()).isEqualByComparingTo(new BigDecimal("180000.00"));
  }

  @Test
  void issueInvoice_multiplePayments_success() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(openSession));
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L))
        .thenReturn(Optional.of(activeStamp));
    when(fiscalStampRepository.lockByIdAndTenantId(5L, 1L)).thenReturn(Optional.of(activeStamp));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    when(invoiceRepository.save(any(Invoice.class))).thenAnswer(inv -> inv.getArgument(0));

    var line = new InvoiceLineRequest(null, "Service", 1, new BigDecimal("100000.00"));
    var p1 = new InvoicePaymentAllocationRequest("CASH", new BigDecimal("60000.00"));
    var p2 = new InvoicePaymentAllocationRequest("CREDIT_CARD", new BigDecimal("40000.00"));
    var request =
        new InvoiceCreateRequest(null, null, null, null, null, List.of(line), List.of(p1, p2));

    InvoiceResponse result = invoiceService.issueInvoice(1L, request);

    assertThat(result.payments()).hasSize(2);
    assertThat(result.total()).isEqualByComparingTo(new BigDecimal("100000.00"));
  }

  @Test
  void issueInvoice_paymentSumMismatch_throwsBadRequest() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(openSession));
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L))
        .thenReturn(Optional.of(activeStamp));
    when(fiscalStampRepository.lockByIdAndTenantId(5L, 1L)).thenReturn(Optional.of(activeStamp));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));

    var line = new InvoiceLineRequest(null, "Service", 1, new BigDecimal("100000.00"));
    var payment = new InvoicePaymentAllocationRequest("CASH", new BigDecimal("99000.00"));
    var request =
        new InvoiceCreateRequest(null, null, null, null, null, List.of(line), List.of(payment));

    assertThatThrownBy(() -> invoiceService.issueInvoice(1L, request))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex -> {
              ResponseStatusException rse = (ResponseStatusException) ex;
              assertThat(rse.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
              assertThat(rse.getReason()).isEqualTo("PAYMENT_SUM_MISMATCH");
            });
  }

  @Test
  void issueInvoice_noCashSession_throwsConflict() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.empty());

    var line = new InvoiceLineRequest(null, "Service", 1, new BigDecimal("50000.00"));
    var payment = new InvoicePaymentAllocationRequest("CASH", new BigDecimal("50000.00"));
    var request =
        new InvoiceCreateRequest(null, null, null, null, null, List.of(line), List.of(payment));

    assertThatThrownBy(() -> invoiceService.issueInvoice(1L, request))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex -> {
              ResponseStatusException rse = (ResponseStatusException) ex;
              assertThat(rse.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
              assertThat(rse.getReason()).isEqualTo("CASH_SESSION_NOT_OPEN");
            });
  }

  @Test
  void issueInvoice_noActiveFiscalStamp_throwsConflict() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(openSession));
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L)).thenReturn(Optional.empty());

    var line = new InvoiceLineRequest(null, "Service", 1, new BigDecimal("50000.00"));
    var payment = new InvoicePaymentAllocationRequest("CASH", new BigDecimal("50000.00"));
    var request =
        new InvoiceCreateRequest(null, null, null, null, null, List.of(line), List.of(payment));

    assertThatThrownBy(() -> invoiceService.issueInvoice(1L, request))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex -> {
              ResponseStatusException rse = (ResponseStatusException) ex;
              assertThat(rse.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
              assertThat(rse.getReason()).isEqualTo("NO_ACTIVE_FISCAL_STAMP");
            });
  }

  @Test
  void voidInvoice_success() {
    Invoice invoice = buildIssuedInvoice();
    when(invoiceRepository.findByIdAndTenant_Id(100L, 1L)).thenReturn(Optional.of(invoice));

    InvoiceResponse result =
        invoiceService.voidInvoice(1L, 100L, new InvoiceVoidRequest("Error en factura"));

    assertThat(result.status()).isEqualTo(InvoiceStatus.VOIDED.name());
    assertThat(result.voidReason()).isEqualTo("Error en factura");
  }

  @Test
  void voidInvoice_sessionClosed_throwsConflict() {
    Invoice invoice = buildIssuedInvoice();
    invoice.getCashSession().setClosedAt(Instant.now());
    when(invoiceRepository.findByIdAndTenant_Id(100L, 1L)).thenReturn(Optional.of(invoice));

    assertThatThrownBy(() -> invoiceService.voidInvoice(1L, 100L, new InvoiceVoidRequest("Reason")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex -> {
              ResponseStatusException rse = (ResponseStatusException) ex;
              assertThat(rse.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
              assertThat(rse.getReason()).isEqualTo("CASH_SESSION_CLOSED_CANNOT_VOID");
            });
  }

  @Test
  void voidInvoice_alreadyVoided_throwsConflict() {
    Invoice invoice = buildIssuedInvoice();
    invoice.setStatus(InvoiceStatus.VOIDED);
    when(invoiceRepository.findByIdAndTenant_Id(100L, 1L)).thenReturn(Optional.of(invoice));

    assertThatThrownBy(() -> invoiceService.voidInvoice(1L, 100L, new InvoiceVoidRequest("Reason")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex -> {
              ResponseStatusException rse = (ResponseStatusException) ex;
              assertThat(rse.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
              assertThat(rse.getReason()).isEqualTo("INVOICE_ALREADY_VOIDED");
            });
  }

  @Test
  void formatInvoiceNumber_pads7Digits() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(openSession));
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L))
        .thenReturn(Optional.of(activeStamp));
    when(fiscalStampRepository.lockByIdAndTenantId(5L, 1L)).thenReturn(Optional.of(activeStamp));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    when(invoiceRepository.save(any(Invoice.class))).thenAnswer(inv -> inv.getArgument(0));

    var line = new InvoiceLineRequest(null, "S", 1, new BigDecimal("10.00"));
    var payment = new InvoicePaymentAllocationRequest("CASH", new BigDecimal("10.00"));
    var request =
        new InvoiceCreateRequest(null, null, null, null, null, List.of(line), List.of(payment));

    InvoiceResponse result = invoiceService.issueInvoice(1L, request);

    assertThat(result.invoiceNumberFormatted()).hasSize(7);
    assertThat(result.invoiceNumberFormatted()).startsWith("000000");
  }

  @Test
  void resolveInvoiceListRange_incompleteRejects() {
    Instant a = Instant.parse("2026-01-01T00:00:00Z");
    assertThatThrownBy(() -> InvoiceService.resolveInvoiceListRange(a, null, null))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            e -> {
              ResponseStatusException r = (ResponseStatusException) e;
              assertThat(r.getStatusCode().value()).isEqualTo(400);
              assertThat(r.getReason()).isEqualTo("INVOICE_LIST_RANGE_INCOMPLETE");
            });
  }

  @Test
  void resolveInvoiceListRange_rejectsOver31InclusiveDays() {
    ZoneId z = ZoneId.systemDefault();
    Instant from = LocalDate.of(2025, 1, 1).atStartOfDay(z).toInstant();
    Instant to = LocalDate.of(2025, 2, 1).atTime(23, 59, 59, 999_000_000).atZone(z).toInstant();
    assertThatThrownBy(() -> InvoiceService.resolveInvoiceListRange(from, to, null))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            e -> {
              ResponseStatusException r = (ResponseStatusException) e;
              assertThat(r.getReason()).isEqualTo("INVOICE_LIST_RANGE_EXCEEDS_ONE_MONTH");
            });
  }

  @Test
  void resolveInvoiceListRange_allows31InclusiveCalendarDays() {
    ZoneId z = ZoneId.systemDefault();
    Instant from = LocalDate.of(2025, 1, 1).atStartOfDay(z).toInstant();
    Instant to = LocalDate.of(2025, 1, 31).atTime(23, 59, 59, 999_000_000).atZone(z).toInstant();
    Instant[] r = InvoiceService.resolveInvoiceListRange(from, to, null);
    assertThat(r[0]).isEqualTo(from);
    assertThat(r[1]).isEqualTo(to);
  }

  @Test
  void resolveInvoiceListRange_defaultIsTwoLocalDays() {
    Instant[] r = InvoiceService.resolveInvoiceListRange(null, null, null);
    ZoneId z = ZoneId.systemDefault();
    LocalDate d0 = r[0].atZone(z).toLocalDate();
    LocalDate d1 = r[1].atZone(z).toLocalDate();
    long inclusive = ChronoUnit.DAYS.between(d0, d1) + 1;
    assertThat(inclusive).isEqualTo(2L);
  }

  @Test
  void resolveInvoiceListRange_withClientIdAndNoDates_returnsNullNull() {
    Instant[] r = InvoiceService.resolveInvoiceListRange(null, null, 42L);
    assertThat(r[0]).isNull();
    assertThat(r[1]).isNull();
  }

  private Invoice buildIssuedInvoice() {
    Invoice invoice = new Invoice();
    invoice.setId(100L);
    invoice.setTenant(tenant);
    invoice.setCashSession(openSession);
    invoice.setFiscalStamp(activeStamp);
    invoice.setInvoiceNumber(43);
    invoice.setStatus(InvoiceStatus.ISSUED);
    invoice.setSubtotal(new BigDecimal("50000.00"));
    invoice.setTotal(new BigDecimal("50000.00"));
    invoice.setIssuedAt(Instant.now());
    invoice.setDiscountType(DiscountType.NONE);
    return invoice;
  }
}
