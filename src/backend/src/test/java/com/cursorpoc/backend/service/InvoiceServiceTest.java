package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.CashSession;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.FiscalStamp;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.DiscountType;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.repository.BusinessProfileRepository;
import com.cursorpoc.backend.repository.CashSessionRepository;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.FiscalStampRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.repository.ServiceRecordRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.InvoiceCreateRequest;
import com.cursorpoc.backend.web.dto.InvoiceLineRequest;
import com.cursorpoc.backend.web.dto.InvoicePaymentAllocationRequest;
import com.cursorpoc.backend.web.dto.InvoiceResponse;
import com.cursorpoc.backend.web.dto.InvoiceVoidRequest;
import com.cursorpoc.backend.web.dto.PagedInvoicesResponse;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
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
  @Mock private BusinessProfileRepository businessProfileRepository;
  @Mock private ServiceRecordRepository serviceRecordRepository;
  @Mock private SifenInvoiceHeaderService sifenInvoiceHeaderService;

  // SIFEN HU-10: a real instance (via @Spy, not @Mock) so @InjectMocks' constructor injection
  // resolves this new dependency to something whose zoneId() actually works, same as every other
  // SIFEN service test that just does `new FemmeTimeProperties()` directly (e.g.
  // SifenInvoiceSubmissionServiceTest) — this test just can't do that construction manually because
  // it relies on @InjectMocks for the rest of InvoiceService's dependencies.
  @Spy private FemmeTimeProperties timeProperties = new FemmeTimeProperties();

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

    var line = new InvoiceLineRequest(null, "Haircut", 1, new BigDecimal("50000.00"), null, null);
    var payment =
        new InvoicePaymentAllocationRequest("CASH", new BigDecimal("50000.00"), null, null);
    var request =
        new InvoiceCreateRequest(
            null, null, null, null, null, List.of(line), List.of(payment), null, null);

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

  /**
   * Issue #96: a client is selected but display name and RUC are left blank — both must stay blank
   * on the invoice (the PDF layer prints "Sin nombre" / a blank RUC), not silently fall back to the
   * client's profile name/RUC.
   */
  @Test
  void issueInvoice_clientSelectedBlankDisplayNameAndRuc_staysBlank() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(openSession));
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L))
        .thenReturn(Optional.of(activeStamp));
    when(fiscalStampRepository.lockByIdAndTenantId(5L, 1L)).thenReturn(Optional.of(activeStamp));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));

    Client client = new Client();
    client.setId(7L);
    client.setTenant(tenant);
    client.setFullName("Ana García");
    client.setRuc("80000005-6");
    when(clientRepository.findByIdAndTenant_Id(7L, 1L)).thenReturn(Optional.of(client));

    when(invoiceRepository.save(any(Invoice.class)))
        .thenAnswer(
            inv -> {
              Invoice i = inv.getArgument(0);
              i.setId(101L);
              return i;
            });

    var line = new InvoiceLineRequest(null, "Haircut", 1, new BigDecimal("50000.00"), null, null);
    var payment =
        new InvoicePaymentAllocationRequest("CASH", new BigDecimal("50000.00"), null, null);
    var request =
        new InvoiceCreateRequest(
            7L, "  ", "  ", null, null, List.of(line), List.of(payment), null, null);

    InvoiceResponse result = invoiceService.issueInvoice(1L, request);

    assertThat(result.clientId()).isEqualTo(7L);
    assertThat(result.clientDisplayName()).isNull();
    assertThat(result.clientRucOverride()).isNull();
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

    var line = new InvoiceLineRequest(null, "Color", 1, new BigDecimal("100000.00"), null, null);
    var payment =
        new InvoicePaymentAllocationRequest("DEBIT_CARD", new BigDecimal("90000.00"), "VISA", null);
    var request =
        new InvoiceCreateRequest(
            null,
            null,
            null,
            "FIXED",
            new BigDecimal("10000.00"),
            List.of(line),
            List.of(payment),
            null,
            null);

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

    var line = new InvoiceLineRequest(null, "Mani", 1, new BigDecimal("200000.00"), null, null);
    var payment =
        new InvoicePaymentAllocationRequest("CASH", new BigDecimal("180000.00"), null, null);
    var request =
        new InvoiceCreateRequest(
            null,
            null,
            null,
            "PERCENT",
            new BigDecimal("10"),
            List.of(line),
            List.of(payment),
            null,
            null);

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

    var line = new InvoiceLineRequest(null, "Service", 1, new BigDecimal("100000.00"), null, null);
    var p1 = new InvoicePaymentAllocationRequest("CASH", new BigDecimal("60000.00"), null, null);
    var p2 =
        new InvoicePaymentAllocationRequest(
            "CREDIT_CARD", new BigDecimal("40000.00"), "VISA", null);
    var request =
        new InvoiceCreateRequest(
            null, null, null, null, null, List.of(line), List.of(p1, p2), null, null);

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

    var line = new InvoiceLineRequest(null, "Service", 1, new BigDecimal("100000.00"), null, null);
    var payment =
        new InvoicePaymentAllocationRequest("CASH", new BigDecimal("99000.00"), null, null);
    var request =
        new InvoiceCreateRequest(
            null, null, null, null, null, List.of(line), List.of(payment), null, null);

    assertThatThrownBy(() -> invoiceService.issueInvoice(1L, request))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex -> {
              ResponseStatusException rse = (ResponseStatusException) ex;
              assertThat(rse.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
              assertThat(rse.getReason()).isEqualTo("PAYMENT_SUM_MISMATCH");
            });
  }

  /**
   * Issue #170: SIFEN rejects card payments missing the mandatory E7.1.1/gPagTarCD group — the card
   * brand must be captured at issuance so it can always be emitted.
   */
  @Test
  void issueInvoice_creditCardPaymentWithoutBrand_throwsBadRequest() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(openSession));
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L))
        .thenReturn(Optional.of(activeStamp));
    when(fiscalStampRepository.lockByIdAndTenantId(5L, 1L)).thenReturn(Optional.of(activeStamp));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));

    var line = new InvoiceLineRequest(null, "Service", 1, new BigDecimal("100000.00"), null, null);
    var payment =
        new InvoicePaymentAllocationRequest("CREDIT_CARD", new BigDecimal("100000.00"), null, null);
    var request =
        new InvoiceCreateRequest(
            null, null, null, null, null, List.of(line), List.of(payment), null, null);

    assertThatThrownBy(() -> invoiceService.issueInvoice(1L, request))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex -> {
              ResponseStatusException rse = (ResponseStatusException) ex;
              assertThat(rse.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
              assertThat(rse.getReason()).isEqualTo("CARD_BRAND_REQUIRED");
            });
  }

  @Test
  void issueInvoice_debitCardPaymentWithOtherBrandButNoDescription_throwsBadRequest() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(openSession));
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L))
        .thenReturn(Optional.of(activeStamp));
    when(fiscalStampRepository.lockByIdAndTenantId(5L, 1L)).thenReturn(Optional.of(activeStamp));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));

    var line = new InvoiceLineRequest(null, "Service", 1, new BigDecimal("100000.00"), null, null);
    var payment =
        new InvoicePaymentAllocationRequest(
            "DEBIT_CARD", new BigDecimal("100000.00"), "OTHER", "  ");
    var request =
        new InvoiceCreateRequest(
            null, null, null, null, null, List.of(line), List.of(payment), null, null);

    assertThatThrownBy(() -> invoiceService.issueInvoice(1L, request))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex -> {
              ResponseStatusException rse = (ResponseStatusException) ex;
              assertThat(rse.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
              assertThat(rse.getReason()).isEqualTo("CARD_BRAND_OTHER_DESCRIPTION_REQUIRED");
            });
  }

  @Test
  void issueInvoice_debitCardPaymentWithOtherBrandAndDescription_succeeds() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(openSession));
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L))
        .thenReturn(Optional.of(activeStamp));
    when(fiscalStampRepository.lockByIdAndTenantId(5L, 1L)).thenReturn(Optional.of(activeStamp));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    when(invoiceRepository.save(any(Invoice.class))).thenAnswer(inv -> inv.getArgument(0));

    var line = new InvoiceLineRequest(null, "Service", 1, new BigDecimal("100000.00"), null, null);
    var payment =
        new InvoicePaymentAllocationRequest(
            "DEBIT_CARD", new BigDecimal("100000.00"), "OTHER", "Union Pay");
    var request =
        new InvoiceCreateRequest(
            null, null, null, null, null, List.of(line), List.of(payment), null, null);

    InvoiceResponse result = invoiceService.issueInvoice(1L, request);

    assertThat(result.payments()).hasSize(1);
    assertThat(result.payments().get(0).cardBrand()).isEqualTo("OTHER");
    assertThat(result.payments().get(0).cardBrandOtherDescription()).isEqualTo("Union Pay");
  }

  @Test
  void issueInvoice_withTipsAmount_paymentsMustCoverTotalOnly() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(openSession));
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L))
        .thenReturn(Optional.of(activeStamp));
    when(fiscalStampRepository.lockByIdAndTenantId(5L, 1L)).thenReturn(Optional.of(activeStamp));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));

    var line = new InvoiceLineRequest(null, "Haircut", 1, new BigDecimal("50000.00"), null, null);
    var paymentIncludingTip =
        new InvoicePaymentAllocationRequest("CASH", new BigDecimal("60000.00"), null, null);
    var requestTooHigh =
        new InvoiceCreateRequest(
            null,
            null,
            null,
            null,
            null,
            List.of(line),
            List.of(paymentIncludingTip),
            null,
            new BigDecimal("10000.00"));

    // Issue #139: tips never factor into the amount to reconcile — paying total + tip
    // (60000, ignoring that only 50000 is the fiscal total) must be rejected.
    assertThatThrownBy(() -> invoiceService.issueInvoice(1L, requestTooHigh))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex -> {
              ResponseStatusException rse = (ResponseStatusException) ex;
              assertThat(rse.getReason()).isEqualTo("PAYMENT_SUM_MISMATCH");
            });

    when(invoiceRepository.save(any(Invoice.class))).thenAnswer(inv -> inv.getArgument(0));
    var paymentCoveringTotalOnly =
        new InvoicePaymentAllocationRequest("CASH", new BigDecimal("50000.00"), null, null);
    var requestOk =
        new InvoiceCreateRequest(
            null,
            null,
            null,
            null,
            null,
            List.of(line),
            List.of(paymentCoveringTotalOnly),
            null,
            new BigDecimal("10000.00"));

    InvoiceResponse result = invoiceService.issueInvoice(1L, requestOk);

    // Tips are collected/stored but never touch the fiscal subtotal/total nor the
    // required payment sum.
    assertThat(result.total()).isEqualByComparingTo(new BigDecimal("50000.00"));
    assertThat(result.tipsAmount()).isEqualByComparingTo(new BigDecimal("10000.00"));
  }

  @Test
  void issueInvoice_withServiceRecordId_closesLinkedFichaAndLinksInvoice() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(openSession));
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L))
        .thenReturn(Optional.of(activeStamp));
    when(fiscalStampRepository.lockByIdAndTenantId(5L, 1L)).thenReturn(Optional.of(activeStamp));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    when(invoiceRepository.save(any(Invoice.class))).thenAnswer(inv -> inv.getArgument(0));

    com.cursorpoc.backend.domain.ServiceRecord serviceRecord =
        new com.cursorpoc.backend.domain.ServiceRecord();
    serviceRecord.setId(200L);
    serviceRecord.setTenant(tenant);
    serviceRecord.setStatus(com.cursorpoc.backend.domain.enums.ServiceRecordStatus.OPEN);
    when(serviceRecordRepository.findByIdAndTenant_Id(200L, 1L))
        .thenReturn(Optional.of(serviceRecord));
    when(invoiceRepository.existsByServiceRecord_Id(200L)).thenReturn(false);

    var line = new InvoiceLineRequest(null, "Haircut", 1, new BigDecimal("50000.00"), null, null);
    var payment =
        new InvoicePaymentAllocationRequest("CASH", new BigDecimal("50000.00"), null, null);
    var request =
        new InvoiceCreateRequest(
            null, null, null, null, null, List.of(line), List.of(payment), 200L, null);

    InvoiceResponse result = invoiceService.issueInvoice(1L, request);

    assertThat(result.serviceRecordId()).isEqualTo(200L);
    assertThat(serviceRecord.getStatus())
        .isEqualTo(com.cursorpoc.backend.domain.enums.ServiceRecordStatus.CLOSED);
    assertThat(serviceRecord.getClosedAt()).isNotNull();
  }

  @Test
  void issueInvoice_withServiceRecordId_alreadyInvoiced_throwsConflict() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(openSession));
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L))
        .thenReturn(Optional.of(activeStamp));
    when(fiscalStampRepository.lockByIdAndTenantId(5L, 1L)).thenReturn(Optional.of(activeStamp));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));

    com.cursorpoc.backend.domain.ServiceRecord serviceRecord =
        new com.cursorpoc.backend.domain.ServiceRecord();
    serviceRecord.setId(201L);
    serviceRecord.setTenant(tenant);
    serviceRecord.setStatus(com.cursorpoc.backend.domain.enums.ServiceRecordStatus.OPEN);
    when(serviceRecordRepository.findByIdAndTenant_Id(201L, 1L))
        .thenReturn(Optional.of(serviceRecord));
    when(invoiceRepository.existsByServiceRecord_Id(201L)).thenReturn(true);

    var line = new InvoiceLineRequest(null, "Haircut", 1, new BigDecimal("50000.00"), null, null);
    var payment =
        new InvoicePaymentAllocationRequest("CASH", new BigDecimal("50000.00"), null, null);
    var request =
        new InvoiceCreateRequest(
            null, null, null, null, null, List.of(line), List.of(payment), 201L, null);

    assertThatThrownBy(() -> invoiceService.issueInvoice(1L, request))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            ex -> {
              ResponseStatusException rse = (ResponseStatusException) ex;
              assertThat(rse.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
              assertThat(rse.getReason()).isEqualTo("SERVICE_RECORD_ALREADY_INVOICED");
            });
  }

  @Test
  void issueInvoice_noCashSession_throwsConflict() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.empty());

    var line = new InvoiceLineRequest(null, "Service", 1, new BigDecimal("50000.00"), null, null);
    var payment =
        new InvoicePaymentAllocationRequest("CASH", new BigDecimal("50000.00"), null, null);
    var request =
        new InvoiceCreateRequest(
            null, null, null, null, null, List.of(line), List.of(payment), null, null);

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

    var line = new InvoiceLineRequest(null, "Service", 1, new BigDecimal("50000.00"), null, null);
    var payment =
        new InvoicePaymentAllocationRequest("CASH", new BigDecimal("50000.00"), null, null);
    var request =
        new InvoiceCreateRequest(
            null, null, null, null, null, List.of(line), List.of(payment), null, null);

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

  /**
   * SIFEN HU-09: {@code sifenVerificationUrl} in the response must be exactly whatever HU-08
   * persisted on {@code Invoice.sifenQrUrl} at submission time — the same URL encoded in the KuDE's
   * QR code — with no gating on the invoice's current SIFEN status (AC-05: this must keep working
   * for a cancelled invoice too, once that state exists).
   */
  @Test
  void getInvoice_exposesTheSameUrlPersistedAsSifenQrUrl() {
    Invoice invoice = buildIssuedInvoice();
    invoice.setSifenQrUrl("https://ekuatia.set.gov.py/consultas-test/qr?nVersion=150&Id=abc");
    when(invoiceRepository.findByIdAndTenant_Id(100L, 1L)).thenReturn(Optional.of(invoice));

    InvoiceResponse result = invoiceService.getInvoice(1L, 100L);

    assertThat(result.sifenVerificationUrl())
        .isEqualTo("https://ekuatia.set.gov.py/consultas-test/qr?nVersion=150&Id=abc");
  }

  @Test
  void getInvoice_withoutSifenSubmission_sifenVerificationUrlIsNull() {
    Invoice invoice = buildIssuedInvoice();
    when(invoiceRepository.findByIdAndTenant_Id(100L, 1L)).thenReturn(Optional.of(invoice));

    InvoiceResponse result = invoiceService.getInvoice(1L, 100L);

    assertThat(result.sifenVerificationUrl()).isNull();
  }

  /**
   * SIFEN HU-10 AC-02: the deadline exposed to the frontend must be exactly {@code sifenSubmittedAt
   * + 48h}, converted through the business zone — the same instant {@code
   * SifenInvoiceCancellationService} itself checks.
   */
  @Test
  void getInvoice_approvedInvoice_exposesTheCancellationDeadline48hAfterSubmission() {
    Invoice invoice = buildIssuedInvoice();
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.APPROVED);
    java.time.LocalDateTime submittedAt = java.time.LocalDateTime.of(2026, 7, 28, 10, 0, 0);
    invoice.setSifenSubmittedAt(submittedAt);
    when(invoiceRepository.findByIdAndTenant_Id(100L, 1L)).thenReturn(Optional.of(invoice));

    InvoiceResponse result = invoiceService.getInvoice(1L, 100L);

    assertThat(result.sifenCancellationDeadlineAt())
        .isEqualTo(
            submittedAt.plusHours(48).atZone(java.time.ZoneId.of("America/Asuncion")).toInstant());
  }

  /**
   * Issue #145: mirrors the deadline field above, but offset by {@code MINIMUM_CANCELLATION_DELAY}
   * instead of the 48h window — the instant from which cancellation actually becomes accepted.
   */
  @Test
  void getInvoice_approvedInvoice_exposesTheCancellationAvailableAtAfterMinimumDelay() {
    Invoice invoice = buildIssuedInvoice();
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.APPROVED);
    java.time.LocalDateTime submittedAt = java.time.LocalDateTime.of(2026, 7, 28, 10, 0, 0);
    invoice.setSifenSubmittedAt(submittedAt);
    when(invoiceRepository.findByIdAndTenant_Id(100L, 1L)).thenReturn(Optional.of(invoice));

    InvoiceResponse result = invoiceService.getInvoice(1L, 100L);

    assertThat(result.sifenCancellationAvailableAt())
        .isEqualTo(
            submittedAt
                .plus(SifenInvoiceCancellationService.MINIMUM_CANCELLATION_DELAY)
                .atZone(java.time.ZoneId.of("America/Asuncion"))
                .toInstant());
  }

  @Test
  void getInvoice_pendingVerificationInvoice_hasNoCancellationDeadline() {
    Invoice invoice = buildIssuedInvoice();
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.PENDING_VERIFICATION);
    invoice.setSifenSubmittedAt(null);
    when(invoiceRepository.findByIdAndTenant_Id(100L, 1L)).thenReturn(Optional.of(invoice));

    InvoiceResponse result = invoiceService.getInvoice(1L, 100L);

    assertThat(result.sifenCancellationDeadlineAt()).isNull();
    assertThat(result.sifenCancellationAvailableAt()).isNull();
  }

  /** AC-05: once cancelled, no more deadline is exposed — the option is gone for good. */
  @Test
  void getInvoice_cancelledInvoice_hasNoCancellationDeadlineButExposesTheAuditTrail() {
    Invoice invoice = buildIssuedInvoice();
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.CANCELLED);
    invoice.setSifenSubmittedAt(java.time.LocalDateTime.now().minusHours(2));
    java.time.LocalDateTime requestedAt = java.time.LocalDateTime.of(2026, 7, 28, 11, 30, 0);
    invoice.setSifenCancellationRequestedAt(requestedAt);
    invoice.setSifenCancellationRequestedByEmail("isabelzymanscki@gmail.com");
    invoice.setSifenCancellationReason("Error en el monto facturado");
    invoice.setSifenCancellationResultCode("0600");
    invoice.setSifenCancellationMessage("Evento registrado correctamente");
    when(invoiceRepository.findByIdAndTenant_Id(100L, 1L)).thenReturn(Optional.of(invoice));

    InvoiceResponse result = invoiceService.getInvoice(1L, 100L);

    assertThat(result.sifenCancellationDeadlineAt()).isNull();
    assertThat(result.sifenCancellationAvailableAt()).isNull();
    assertThat(result.sifenCancellationRequestedAt())
        .isEqualTo(requestedAt.atZone(java.time.ZoneId.of("America/Asuncion")).toInstant());
    assertThat(result.sifenCancellationRequestedByEmail()).isEqualTo("isabelzymanscki@gmail.com");
    assertThat(result.sifenCancellationReason()).isEqualTo("Error en el monto facturado");
    assertThat(result.sifenCancellationMessage()).isEqualTo("Evento registrado correctamente");
  }

  /**
   * SIFEN HU-11 AC-01: the "identify client" option is only exposed when the invoice is approved,
   * has no client data, and hasn't already been identified.
   */
  @Test
  void getInvoice_approvedInvoiceWithoutClientData_exposesClientIdentificationEligible() {
    Invoice invoice = buildIssuedInvoice();
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.APPROVED);
    when(invoiceRepository.findByIdAndTenant_Id(100L, 1L)).thenReturn(Optional.of(invoice));
    when(sifenInvoiceHeaderService.isReceiverUnidentified(invoice)).thenReturn(true);

    InvoiceResponse result = invoiceService.getInvoice(1L, 100L);

    assertThat(result.sifenClientIdentificationEligible()).isTrue();
  }

  @Test
  void getInvoice_pendingVerificationInvoice_isNotEligibleForClientIdentification() {
    Invoice invoice = buildIssuedInvoice();
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.PENDING_VERIFICATION);
    when(invoiceRepository.findByIdAndTenant_Id(100L, 1L)).thenReturn(Optional.of(invoice));

    InvoiceResponse result = invoiceService.getInvoice(1L, 100L);

    assertThat(result.sifenClientIdentificationEligible()).isFalse();
  }

  @Test
  void getInvoice_approvedInvoiceWithClientData_isNotEligibleForClientIdentification() {
    Invoice invoice = buildIssuedInvoice();
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.APPROVED);
    when(invoiceRepository.findByIdAndTenant_Id(100L, 1L)).thenReturn(Optional.of(invoice));
    when(sifenInvoiceHeaderService.isReceiverUnidentified(invoice)).thenReturn(false);

    InvoiceResponse result = invoiceService.getInvoice(1L, 100L);

    assertThat(result.sifenClientIdentificationEligible()).isFalse();
  }

  @Test
  void getInvoice_alreadyIdentifiedInvoice_isNoLongerEligibleForClientIdentification() {
    Invoice invoice = buildIssuedInvoice();
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.APPROVED);
    invoice.setSifenClientIdentified(true);
    when(invoiceRepository.findByIdAndTenant_Id(100L, 1L)).thenReturn(Optional.of(invoice));

    InvoiceResponse result = invoiceService.getInvoice(1L, 100L);

    assertThat(result.sifenClientIdentificationEligible()).isFalse();
    assertThat(result.sifenClientIdentified()).isTrue();
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

    var line = new InvoiceLineRequest(null, "S", 1, new BigDecimal("10.00"), null, null);
    var payment = new InvoicePaymentAllocationRequest("CASH", new BigDecimal("10.00"), null, null);
    var request =
        new InvoiceCreateRequest(
            null, null, null, null, null, List.of(line), List.of(payment), null, null);

    InvoiceResponse result = invoiceService.issueInvoice(1L, request);

    assertThat(result.invoiceNumberFormatted()).hasSize(7);
    assertThat(result.invoiceNumberFormatted()).startsWith("000000");
  }

  @Test
  void listInvoices_includesSifenSubmissionStatusInListItem() {
    Invoice submitted = new Invoice();
    submitted.setId(101L);
    submitted.setTenant(tenant);
    submitted.setInvoiceNumber(42);
    submitted.setStatus(InvoiceStatus.ISSUED);
    submitted.setTotal(new BigDecimal("10000"));
    submitted.setIssuedAt(Instant.now());
    submitted.setSifenSubmissionStatus(SifenSubmissionStatus.APPROVED);

    Invoice neverSubmitted = new Invoice();
    neverSubmitted.setId(102L);
    neverSubmitted.setTenant(tenant);
    neverSubmitted.setInvoiceNumber(43);
    neverSubmitted.setStatus(InvoiceStatus.ISSUED);
    neverSubmitted.setTotal(new BigDecimal("5000"));
    neverSubmitted.setIssuedAt(Instant.now());

    when(invoiceRepository.findByTenantWithFiltersPaged(
            eq(1L), any(), any(), any(), any(), any(), any(), any()))
        .thenReturn(new PageImpl<>(List.of(submitted, neverSubmitted)));
    when(invoiceRepository.sumIssuedTotalWithFilters(eq(1L), any(), any(), any(), any(), any()))
        .thenReturn(BigDecimal.ZERO);

    PagedInvoicesResponse result =
        invoiceService.listInvoices(1L, null, null, null, null, null, 0, 10);

    assertThat(result.content()).hasSize(2);
    assertThat(result.content().get(0).sifenSubmissionStatus()).isEqualTo("APPROVED");
    assertThat(result.content().get(1).sifenSubmissionStatus()).isNull();
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
  void resolveInvoiceListRange_rejectsFromOlderThan6Months() {
    ZoneId z = ZoneId.systemDefault();
    // A date well outside the 6-month window
    Instant from = LocalDate.now(z).minusMonths(7).atStartOfDay(z).toInstant();
    Instant to =
        LocalDate.now(z)
            .minusMonths(7)
            .plusDays(5)
            .atTime(23, 59, 59, 999_000_000)
            .atZone(z)
            .toInstant();
    assertThatThrownBy(() -> InvoiceService.resolveInvoiceListRange(from, to, null))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            e -> {
              ResponseStatusException r = (ResponseStatusException) e;
              assertThat(r.getReason()).isEqualTo("INVOICE_LIST_RANGE_TOO_OLD");
            });
  }

  @Test
  void resolveInvoiceListRange_allowsRecentDates() {
    ZoneId z = ZoneId.systemDefault();
    // Dates within the last month are always allowed
    Instant from = LocalDate.now(z).minusDays(7).atStartOfDay(z).toInstant();
    Instant to = LocalDate.now(z).atTime(23, 59, 59, 999_000_000).atZone(z).toInstant();
    Instant[] r = InvoiceService.resolveInvoiceListRange(from, to, null);
    assertThat(r[0]).isEqualTo(from);
    assertThat(r[1]).isEqualTo(to);
  }

  @Test
  void resolveInvoiceListRange_defaultIsLast6Months() {
    Instant[] r = InvoiceService.resolveInvoiceListRange(null, null, null);
    ZoneId z = ZoneId.systemDefault();
    LocalDate d0 = r[0].atZone(z).toLocalDate();
    LocalDate d1 = r[1].atZone(z).toLocalDate();
    // Default from = 6 months ago (start of that day), to = today end
    assertThat(d0).isEqualTo(LocalDate.now(z).minusMonths(InvoiceService.MAX_INVOICE_LIST_MONTHS));
    assertThat(d1).isEqualTo(LocalDate.now(z));
  }

  @Test
  void resolveInvoiceListRange_withClientIdAndNoDates_defaultsToLast6Months() {
    Instant[] r = InvoiceService.resolveInvoiceListRange(null, null, 42L);
    ZoneId z = ZoneId.systemDefault();
    assertThat(r[0]).isNotNull();
    assertThat(r[1]).isNotNull();
    LocalDate d0 = r[0].atZone(z).toLocalDate();
    assertThat(d0).isEqualTo(LocalDate.now(z).minusMonths(InvoiceService.MAX_INVOICE_LIST_MONTHS));
  }

  /**
   * SIFEN HU-02 AC-05: Gs. 7.000.000+ without any client RUC or identity document is rejected
   * before payments are even considered.
   */
  @Test
  void issueInvoice_atThreshold_withoutClientIdentification_throwsBadRequest() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(openSession));
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L))
        .thenReturn(Optional.of(activeStamp));
    when(fiscalStampRepository.lockByIdAndTenantId(5L, 1L)).thenReturn(Optional.of(activeStamp));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));

    var line = new InvoiceLineRequest(null, "Peinado", 1, new BigDecimal("7000000.00"), null, null);
    var payment =
        new InvoicePaymentAllocationRequest("CASH", new BigDecimal("7000000.00"), null, null);
    var request =
        new InvoiceCreateRequest(
            null, null, null, null, null, null, List.of(line), List.of(payment), null, null);

    assertThatThrownBy(() -> invoiceService.issueInvoice(1L, request))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_CLIENT_IDENTIFICATION_REQUIRED");
  }

  /** AC-05: just below the threshold, no identification is required. */
  @Test
  void issueInvoice_justBelowThreshold_withoutClientIdentification_succeeds() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(openSession));
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L))
        .thenReturn(Optional.of(activeStamp));
    when(fiscalStampRepository.lockByIdAndTenantId(5L, 1L)).thenReturn(Optional.of(activeStamp));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    when(invoiceRepository.save(any(Invoice.class))).thenAnswer(inv -> inv.getArgument(0));

    var line = new InvoiceLineRequest(null, "Peinado", 1, new BigDecimal("6999999.00"), null, null);
    var payment =
        new InvoicePaymentAllocationRequest("CASH", new BigDecimal("6999999.00"), null, null);
    var request =
        new InvoiceCreateRequest(
            null, null, null, null, null, null, List.of(line), List.of(payment), null, null);

    InvoiceResponse result = invoiceService.issueInvoice(1L, request);

    assertThat(result.total()).isEqualByComparingTo(new BigDecimal("6999999.00"));
  }

  /**
   * AC-05: a walk-in client identified only by cédula (no RUC) is enough at/above the threshold.
   */
  @Test
  void issueInvoice_atThreshold_withIdentityDocumentOverride_succeeds() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(openSession));
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L))
        .thenReturn(Optional.of(activeStamp));
    when(fiscalStampRepository.lockByIdAndTenantId(5L, 1L)).thenReturn(Optional.of(activeStamp));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    when(invoiceRepository.save(any(Invoice.class))).thenAnswer(inv -> inv.getArgument(0));

    var line = new InvoiceLineRequest(null, "Peinado", 1, new BigDecimal("7000000.00"), null, null);
    var payment =
        new InvoicePaymentAllocationRequest("CASH", new BigDecimal("7000000.00"), null, null);
    var request =
        new InvoiceCreateRequest(
            null, null, null, "4123456", null, null, List.of(line), List.of(payment), null, null);

    InvoiceResponse result = invoiceService.issueInvoice(1L, request);

    assertThat(result.clientIdentityDocumentOverride()).isEqualTo("4123456");
  }

  /** AC-05: a saved client with an on-file RUC also satisfies the threshold. */
  @Test
  void issueInvoice_atThreshold_withExplicitClientRucOverride_succeeds() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(openSession));
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L))
        .thenReturn(Optional.of(activeStamp));
    when(fiscalStampRepository.lockByIdAndTenantId(5L, 1L)).thenReturn(Optional.of(activeStamp));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    when(invoiceRepository.save(any(Invoice.class))).thenAnswer(inv -> inv.getArgument(0));

    Client client = new Client();
    client.setId(7L);
    client.setTenant(tenant);
    client.setFullName("Ana García");
    client.setRuc("80000005-6");
    when(clientRepository.findByIdAndTenant_Id(7L, 1L)).thenReturn(Optional.of(client));

    var line = new InvoiceLineRequest(null, "Peinado", 1, new BigDecimal("7000000.00"), null, null);
    var payment =
        new InvoicePaymentAllocationRequest("CASH", new BigDecimal("7000000.00"), null, null);
    var request =
        new InvoiceCreateRequest(
            7L, null, "80000005-6", null, null, null, List.of(line), List.of(payment), null, null);

    InvoiceResponse result = invoiceService.issueInvoice(1L, request);

    assertThat(result.clientId()).isEqualTo(7L);
  }

  /**
   * The linked client's profile RUC is never used as a fallback for identification: an invoice at
   * or above the threshold must be blocked unless the RUC/document is explicitly sent on this
   * invoice, even when a client with a saved RUC is linked — matches
   * SifenInvoiceHeaderService#buildReceiverData, which no longer falls back either.
   */
  @Test
  void issueInvoice_atThreshold_withClientLinkedButNoRucOverride_throwsBadRequest() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(openSession));
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L))
        .thenReturn(Optional.of(activeStamp));
    when(fiscalStampRepository.lockByIdAndTenantId(5L, 1L)).thenReturn(Optional.of(activeStamp));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));

    Client client = new Client();
    client.setId(7L);
    client.setTenant(tenant);
    client.setFullName("Ana García");
    client.setRuc("80000005-6");
    when(clientRepository.findByIdAndTenant_Id(7L, 1L)).thenReturn(Optional.of(client));

    var line = new InvoiceLineRequest(null, "Peinado", 1, new BigDecimal("7000000.00"), null, null);
    var payment =
        new InvoicePaymentAllocationRequest("CASH", new BigDecimal("7000000.00"), null, null);
    var request =
        new InvoiceCreateRequest(
            7L, null, null, null, null, null, List.of(line), List.of(payment), null, null);

    assertThatThrownBy(() -> invoiceService.issueInvoice(1L, request))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_CLIENT_IDENTIFICATION_REQUIRED");
  }

  /** AC-05: an explicit Innominado type override blocks issuance even if a RUC is also sent. */
  @Test
  void issueInvoice_atThreshold_withExplicitInnominadoTypeOverride_throwsBadRequest() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(openSession));
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L))
        .thenReturn(Optional.of(activeStamp));
    when(fiscalStampRepository.lockByIdAndTenantId(5L, 1L)).thenReturn(Optional.of(activeStamp));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));

    var line = new InvoiceLineRequest(null, "Peinado", 1, new BigDecimal("7000000.00"), null, null);
    var payment =
        new InvoicePaymentAllocationRequest("CASH", new BigDecimal("7000000.00"), null, null);
    var request =
        new InvoiceCreateRequest(
            null,
            null,
            "80000005-6",
            null,
            null,
            null,
            List.of(line),
            List.of(payment),
            null,
            null,
            "INNOMINADO");

    assertThatThrownBy(() -> invoiceService.issueInvoice(1L, request))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_CLIENT_IDENTIFICATION_REQUIRED");
  }

  /** AC-05: an explicit non-RUC type override (e.g. Pasaporte) satisfies the threshold. */
  @Test
  void issueInvoice_atThreshold_withExplicitPasaporteTypeOverride_succeeds() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(openSession));
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L))
        .thenReturn(Optional.of(activeStamp));
    when(fiscalStampRepository.lockByIdAndTenantId(5L, 1L)).thenReturn(Optional.of(activeStamp));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    when(invoiceRepository.save(any(Invoice.class))).thenAnswer(inv -> inv.getArgument(0));

    var line = new InvoiceLineRequest(null, "Peinado", 1, new BigDecimal("7000000.00"), null, null);
    var payment =
        new InvoicePaymentAllocationRequest("CASH", new BigDecimal("7000000.00"), null, null);
    var request =
        new InvoiceCreateRequest(
            null,
            null,
            null,
            "AB123456",
            null,
            null,
            List.of(line),
            List.of(payment),
            null,
            null,
            "PASAPORTE");

    InvoiceResponse result = invoiceService.issueInvoice(1L, request);

    assertThat(result.clientIdentityDocumentTypeOverride()).isEqualTo("PASAPORTE");
  }

  // ── Issue #174 AC-01: diplomatic-exoneration receiver → amounts net of the included 10% IVA ──

  @Test
  void issueInvoice_diplomaticReceiver_stripsIncludedIva() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(openSession));
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L))
        .thenReturn(Optional.of(activeStamp));
    when(fiscalStampRepository.lockByIdAndTenantId(5L, 1L)).thenReturn(Optional.of(activeStamp));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    when(invoiceRepository.save(any(Invoice.class))).thenAnswer(inv -> inv.getArgument(0));

    var line = new InvoiceLineRequest(null, "Corte", 1, new BigDecimal("110000.00"), null, null);
    // 110.000 / 1,10 = 100.000 — that's what the payment must now cover.
    var payment =
        new InvoicePaymentAllocationRequest("CASH", new BigDecimal("100000.00"), null, null);
    var request =
        new InvoiceCreateRequest(
            null,
            "MISION DIPLOMATICA",
            null,
            "DIP-001",
            null,
            null,
            List.of(line),
            List.of(payment),
            null,
            null,
            "TARJETA_DIPLOMATICA",
            null,
            null,
            null);

    InvoiceResponse result = invoiceService.issueInvoice(1L, request);

    assertThat(result.subtotal()).isEqualByComparingTo(new BigDecimal("100000.00"));
    assertThat(result.total()).isEqualByComparingTo(new BigDecimal("100000.00"));
    assertThat(result.lines().get(0).unitPrice()).isEqualByComparingTo(new BigDecimal("100000.00"));
    assertThat(result.lines().get(0).taxRate()).isEqualByComparingTo(BigDecimal.ZERO);
    assertThat(result.lines().get(0).taxAmount()).isEqualByComparingTo(BigDecimal.ZERO);
  }

  // ── Issue #174 AC-04: manual emission date must sit inside SIFEN's -720h/+120h window ──

  @Test
  void issueInvoice_backdatedEmissionDateWithinWindow_isHonoured() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(openSession));
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L))
        .thenReturn(Optional.of(activeStamp));
    when(fiscalStampRepository.lockByIdAndTenantId(5L, 1L)).thenReturn(Optional.of(activeStamp));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    when(invoiceRepository.save(any(Invoice.class))).thenAnswer(inv -> inv.getArgument(0));

    Instant backdated = Instant.now().minusSeconds(5L * 24 * 3600);
    var line = new InvoiceLineRequest(null, "Corte", 1, new BigDecimal("50000.00"), null, null);
    var payment =
        new InvoicePaymentAllocationRequest("CASH", new BigDecimal("50000.00"), null, null);
    var request =
        new InvoiceCreateRequest(
            null,
            null,
            null,
            null,
            null,
            null,
            List.of(line),
            List.of(payment),
            null,
            null,
            null,
            null,
            null,
            backdated.toString());

    InvoiceResponse result = invoiceService.issueInvoice(1L, request);

    assertThat(result.issuedAt()).isEqualTo(backdated);
  }

  @Test
  void issueInvoice_emissionDateTooFarBack_throwsBadRequest() {
    when(cashSessionRepository.findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(1L))
        .thenReturn(Optional.of(openSession));
    when(fiscalStampRepository.findByTenant_IdAndActiveTrue(1L))
        .thenReturn(Optional.of(activeStamp));
    when(fiscalStampRepository.lockByIdAndTenantId(5L, 1L)).thenReturn(Optional.of(activeStamp));
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));

    Instant tooOld = Instant.now().minusSeconds(40L * 24 * 3600);
    var line = new InvoiceLineRequest(null, "Corte", 1, new BigDecimal("50000.00"), null, null);
    var payment =
        new InvoicePaymentAllocationRequest("CASH", new BigDecimal("50000.00"), null, null);
    var request =
        new InvoiceCreateRequest(
            null,
            null,
            null,
            null,
            null,
            null,
            List.of(line),
            List.of(payment),
            null,
            null,
            null,
            null,
            null,
            tooOld.toString());

    assertThatThrownBy(() -> invoiceService.issueInvoice(1L, request))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("INVOICE_ISSUE_DATE_OUT_OF_RANGE");
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
