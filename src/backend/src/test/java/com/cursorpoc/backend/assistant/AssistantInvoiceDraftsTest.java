package com.cursorpoc.backend.assistant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.assistant.AssistantDraftPayloads.InvoiceDraftPayload;
import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.ServiceRecord;
import com.cursorpoc.backend.domain.ServiceRecordLine;
import com.cursorpoc.backend.domain.enums.ServiceRecordStatus;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.repository.ServiceRecordRepository;
import com.cursorpoc.backend.service.AppointmentService;
import com.cursorpoc.backend.service.ClientService;
import com.cursorpoc.backend.service.InvoiceEmissionService;
import com.cursorpoc.backend.service.ProfessionalDirectoryService;
import com.cursorpoc.backend.service.ServiceCatalogService;
import com.cursorpoc.backend.web.dto.AppointmentResponse;
import com.cursorpoc.backend.web.dto.ClientResponse;
import com.cursorpoc.backend.web.dto.InvoiceCreateRequest;
import com.cursorpoc.backend.web.dto.ProfessionalOptionResponse;
import com.cursorpoc.backend.web.dto.ServiceResponse;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** What an invoice draft charges, what it still needs, and the request it becomes. */
class AssistantInvoiceDraftsTest {

  private static final long TENANT = 7L;

  private final ClientService clients = mock(ClientService.class);
  private final ServiceCatalogService catalog = mock(ServiceCatalogService.class);
  private final ProfessionalDirectoryService professionals =
      mock(ProfessionalDirectoryService.class);
  private final AppointmentService appointments = mock(AppointmentService.class);
  private final ServiceRecordRepository records = mock(ServiceRecordRepository.class);
  private final InvoiceRepository invoices = mock(InvoiceRepository.class);
  private final InvoiceEmissionService emission = mock(InvoiceEmissionService.class);
  private final AssistantInvoiceDrafts drafts =
      new AssistantInvoiceDrafts(
          clients,
          catalog,
          professionals,
          appointments,
          records,
          invoices,
          emission,
          new FemmeTimeProperties());

  @BeforeEach
  void setUp() {
    when(catalog.listServices(eq(TENANT), eq(Optional.empty()), any(), eq("SERVICE")))
        .thenReturn(
            List.of(
                service(1, "Corte", 50_000, true),
                service(2, "Tintura", 120_000, true),
                service(3, "Servicio viejo", 10_000, false)));
    when(professionals.listOptions(TENANT))
        .thenReturn(List.of(new ProfessionalOptionResponse(9, "Lucia Perez", "Lu", "Lu", true)));
    when(clients.getById(TENANT, 42)).thenReturn(client(42, "MARIA GOMEZ", null, null, null, null));
  }

  private static ServiceResponse service(long id, String name, long price, boolean active) {
    return new ServiceResponse(
        id,
        1,
        "Cabello",
        "k",
        null,
        null,
        null,
        name,
        BigDecimal.valueOf(price),
        30,
        active,
        "SERVICE",
        null);
  }

  private static ClientResponse client(
      long id, String name, String ruc, String doc, String docType, String email) {
    return new ClientResponse(
        id,
        name,
        "0981",
        email,
        ruc,
        true,
        0,
        doc,
        null,
        null,
        null,
        null,
        null,
        docType,
        ruc != null ? "PERSONA_FISICA" : null,
        null,
        null,
        null,
        null,
        null,
        null);
  }

  private static Request req(Long clientId, List<Long> serviceIds) {
    return new Request(clientId, serviceIds, null, null, null, null);
  }

  private record Request(
      Long clientId,
      List<Long> serviceIds,
      Long professionalId,
      Long appointmentId,
      String method,
      String email)
      implements java.util.function.Supplier<AssistantInvoiceDrafts.Request> {
    @Override
    public AssistantInvoiceDrafts.Request get() {
      return new AssistantInvoiceDrafts.Request(
          clientId, serviceIds, professionalId, appointmentId, method, email);
    }
  }

  private InvoiceDraftPayload build(Request r) {
    return drafts.build(TENANT, r.get());
  }

  // ---------------------------------------------------------------------------------------------

  @Test
  void catalogServices_arePricedByTheCatalog_withQuantityForRepeatedIds() {
    InvoiceDraftPayload p = build(req(42L, List.of(1L, 2L, 1L)));

    assertThat(p.lines()).hasSize(2);
    assertThat(p.lines().get(0).name()).isEqualTo("Corte");
    assertThat(p.lines().get(0).quantity()).isEqualTo(2);
    assertThat(p.lines().get(0).lineTotal()).isEqualByComparingTo("100000");
    assertThat(p.total()).isEqualByComparingTo("220000");
    assertThat(p.serviceRecordId()).isNull();
    assertThat(p.appointmentId()).isNull();
    assertThat(p.paymentMethod()).isNull();
  }

  private InvoiceDraftPayload buildWithPrices(List<Long> serviceIds, Map<Long, BigDecimal> prices) {
    return drafts.build(
        TENANT,
        new AssistantInvoiceDrafts.Request(42L, serviceIds, null, null, null, null, prices));
  }

  @Test
  void aPriceThePersonSaid_arrivesAsAnEditedPrice_andTheTotalFollowsIt() {
    InvoiceDraftPayload p =
        buildWithPrices(List.of(1L, 2L, 1L), Map.of(1L, new BigDecimal("45000")));

    // Corte ×2 at the price they said; Tintura untouched (catalog).
    assertThat(p.lines().get(0).unitPrice()).isEqualByComparingTo("45000");
    assertThat(p.lines().get(0).lineTotal()).isEqualByComparingTo("90000");
    assertThat(p.lines().get(0).priceEdited()).isTrue();
    assertThat(p.lines().get(1).unitPrice()).isEqualByComparingTo("120000");
    assertThat(p.lines().get(1).priceEdited()).isNull();
    assertThat(p.total()).isEqualByComparingTo("210000");
  }

  @Test
  void aSaidPrice_survivesRepricing_whileAnUntouchedLineFollowsTheCatalog() {
    InvoiceDraftPayload p = buildWithPrices(List.of(1L, 2L), Map.of(1L, new BigDecimal("45000")));
    when(catalog.listServices(eq(TENANT), eq(Optional.empty()), any(), eq("SERVICE")))
        .thenReturn(
            List.of(service(1, "Corte", 65_000, true), service(2, "Tintura", 130_000, true)));

    InvoiceDraftPayload fresh = drafts.reprice(TENANT, p);

    assertThat(fresh.lines().get(0).unitPrice()).isEqualByComparingTo("45000");
    assertThat(fresh.lines().get(1).unitPrice()).isEqualByComparingTo("130000");
  }

  @Test
  void aSaidPrice_mustBeValid_andForAServiceOnTheInvoice() {
    for (String bad : List.of("0", "-5", "1500.5", "1000000000")) {
      assertThatThrownBy(() -> buildWithPrices(List.of(1L), Map.of(1L, new BigDecimal(bad))))
          .as(bad)
          .hasMessage("INVALID_PRICE");
    }
    // Service 2 is not on the invoice: the assistant must ask, not guess.
    assertThatThrownBy(() -> buildWithPrices(List.of(1L), Map.of(2L, new BigDecimal("1000"))))
        .hasMessage("PRICE_SERVICE_NOT_IN_INVOICE");
  }

  @Test
  void anInactiveOrUnknownService_isRefused() {
    assertThatThrownBy(() -> build(req(42L, List.of(3L)))).hasMessage("SERVICE_NOT_FOUND");
    assertThatThrownBy(() -> build(req(42L, List.of(99L)))).hasMessage("SERVICE_NOT_FOUND");
  }

  @Test
  void aProfessionalThatIsInactiveOrUnknown_isRefused() {
    assertThatThrownBy(() -> build(new Request(42L, List.of(1L), 77L, null, null, null)))
        .hasMessage("PROFESSIONAL_NOT_FOUND");
  }

  @Test
  void withoutServices_itChargesTheClientsOpenServiceRecord() {
    ServiceRecord record = mock(ServiceRecord.class);
    ServiceRecordLine withPrice = recordLine(2, "Tintura especial", 150_000, 1, 9L);
    // The ficha stores 0 for a line nobody priced (an explicit price must be > 0): catalog price.
    ServiceRecordLine catalogPrice = recordLine(1, null, 0, 2, null);
    when(record.getId()).thenReturn(500L);
    when(record.getLines()).thenReturn(List.of(withPrice, catalogPrice));
    when(record.getCreatedAt()).thenReturn(Instant.now());
    when(records.findByTenantAndClientAndStatusWithLines(TENANT, 42L, ServiceRecordStatus.OPEN))
        .thenReturn(List.of(record));

    InvoiceDraftPayload p = build(req(42L, null));

    assertThat(p.serviceRecordId()).isEqualTo(500L);
    assertThat(p.lines().get(0).name()).isEqualTo("Tintura especial");
    assertThat(p.lines().get(0).unitPrice()).isEqualByComparingTo("150000");
    // No price on the record line: the catalog price, times the quantity.
    assertThat(p.lines().get(1).unitPrice()).isEqualByComparingTo("50000");
    assertThat(p.total()).isEqualByComparingTo("250000");
  }

  @Test
  void anAlreadyInvoicedServiceRecord_isNotUsed() {
    ServiceRecord record = mock(ServiceRecord.class);
    ServiceRecordLine line = recordLine(1, null, null, 1, null);
    when(record.getId()).thenReturn(500L);
    when(record.getLines()).thenReturn(List.of(line));
    when(record.getCreatedAt()).thenReturn(Instant.now());
    when(records.findByTenantAndClientAndStatusWithLines(TENANT, 42L, ServiceRecordStatus.OPEN))
        .thenReturn(List.of(record));
    when(invoices.existsByServiceRecord_Id(500L)).thenReturn(true);

    assertThatThrownBy(() -> build(req(42L, null))).hasMessage("NOTHING_TO_INVOICE");
  }

  @Test
  void withoutRecordOrServices_itChargesTheSingleAppointmentOfToday() {
    when(appointments.list(eq(TENANT), any(), any(), eq(null), eq(42L)))
        .thenReturn(List.of(appointment(70, 1, "PENDING", null)));

    InvoiceDraftPayload p = build(req(42L, null));

    assertThat(p.appointmentId()).isEqualTo(70L);
    assertThat(p.lines()).hasSize(1);
    assertThat(p.lines().get(0).professionalId()).isEqualTo(9L);
    assertThat(p.total()).isEqualByComparingTo("50000");
  }

  @Test
  void severalAppointmentsOfToday_areReportedSoTheAssistantCanAsk() {
    when(appointments.list(eq(TENANT), any(), any(), eq(null), eq(42L)))
        .thenReturn(
            List.of(
                appointment(70, 1, "PENDING", null),
                appointment(71, 2, "CONFIRMED", null),
                appointment(72, 1, "CANCELLED", null),
                appointment(73, 1, "COMPLETED", 999L)));

    assertThatThrownBy(() -> build(req(42L, null)))
        .isInstanceOfSatisfying(
            AssistantTools.ToolException.class,
            e -> {
              assertThat(e.getMessage()).isEqualTo("MULTIPLE_APPOINTMENTS");
              assertThat((List<?>) e.extra().get("appointments")).hasSize(2);
            });
  }

  @Test
  void nothingToCharge_isReported() {
    when(appointments.list(anyLong(), any(), any(), any(), any())).thenReturn(List.of());

    assertThatThrownBy(() -> build(req(42L, null))).hasMessage("NOTHING_TO_INVOICE");
  }

  @Test
  void aDiplomaticClient_isSentToTheFullBillingScreen() {
    when(clients.getById(TENANT, 43))
        .thenReturn(client(43, "EMBAJADA", null, "D-1", "TARJETA_DIPLOMATICA", null));

    assertThatThrownBy(() -> build(req(43L, List.of(1L))))
        .hasMessage("CLIENT_REQUIRES_MANUAL_INVOICE");
  }

  @Test
  void theClientsEmailIsTheDefault_whenItIsValid() {
    when(clients.getById(TENANT, 44))
        .thenReturn(client(44, "ANA", null, null, null, "ana@mail.com"));
    when(clients.getById(TENANT, 45))
        .thenReturn(client(45, "BEA", null, null, null, "no-es-un-email"));

    assertThat(build(req(44L, List.of(1L))).email()).isEqualTo("ana@mail.com");
    assertThat(build(req(45L, List.of(1L))).email()).isNull();
  }

  // ---------------------------------------------------------------------------------------------

  @Test
  void whatIsMissing_dependsOnPaymentCardBrandAndSifen() {
    InvoiceDraftPayload p = build(req(42L, List.of(1L)));
    assertThat(drafts.missing(TENANT, p)).containsExactly("PAYMENT_METHOD");

    InvoiceDraftPayload card = p.withPayment("CREDIT_CARD", null);
    assertThat(drafts.missing(TENANT, card)).containsExactly("CARD_BRAND");
    assertThat(drafts.missing(TENANT, card.withPayment("CREDIT_CARD", "VISA"))).isEmpty();
    assertThat(drafts.missing(TENANT, p.withPayment("CASH", null))).isEmpty();
  }

  @Test
  void sifenNeedsAnEmail_onlyForAnIdentifiedReceiver() {
    when(clients.getById(TENANT, 46))
        .thenReturn(client(46, "EMPRESA", "80000005-6", null, null, null));
    InvoiceDraftPayload identified = build(req(46L, List.of(1L))).withPayment("CASH", null);
    InvoiceDraftPayload anonymous = build(req(42L, List.of(1L))).withPayment("CASH", null);

    when(emission.isSifenEnabled(TENANT)).thenReturn(false);
    assertThat(drafts.missing(TENANT, identified)).isEmpty();

    when(emission.isSifenEnabled(TENANT)).thenReturn(true);
    assertThat(drafts.missing(TENANT, identified)).containsExactly("EMAIL");
    assertThat(drafts.missing(TENANT, anonymous)).isEmpty();
    assertThat(drafts.missing(TENANT, identified.withEmail("e@mail.com"))).isEmpty();
  }

  @Test
  void completing_validatesEveryValue() {
    InvoiceDraftPayload p = build(req(42L, List.of(1L)));

    assertThat(drafts.complete(p, "cash", null, null).paymentMethod()).isEqualTo("CASH");
    assertThatThrownBy(() -> drafts.complete(p, "BITCOIN", null, null))
        .isInstanceOf(AssistantDraftException.class)
        .hasMessage("ASSISTANT_DRAFT_INVALID_PAYMENT");
    // A brand only makes sense for a card.
    assertThatThrownBy(() -> drafts.complete(p, null, "VISA", null))
        .isInstanceOf(AssistantDraftException.class);
    assertThatThrownBy(() -> drafts.complete(p.withPayment("CASH", null), null, "VISA", null))
        .isInstanceOf(AssistantDraftException.class);
    assertThat(drafts.complete(p.withPayment("DEBIT_CARD", null), null, "visa", null).cardBrand())
        .isEqualTo("VISA");
    assertThatThrownBy(() -> drafts.complete(p, null, null, "nope"))
        .isInstanceOf(AssistantDraftException.class)
        .hasMessage("ASSISTANT_DRAFT_INVALID_EMAIL");
    assertThat(drafts.complete(p, null, null, " a@b.com ").email()).isEqualTo("a@b.com");
    // Switching from card to cash drops the brand.
    InvoiceDraftPayload card = p.withPayment("CREDIT_CARD", "VISA");
    assertThat(drafts.complete(card, "CASH", null, null).cardBrand()).isNull();
  }

  @Test
  void theFingerprint_changesWithWhatIsChargedButNotWithPaymentOrEmail() {
    InvoiceDraftPayload p = build(req(42L, List.of(1L)));

    assertThat(AssistantInvoiceDrafts.fingerprint(p))
        .isEqualTo(
            AssistantInvoiceDrafts.fingerprint(p.withPayment("CASH", null).withEmail("a@b.com")));
    assertThat(AssistantInvoiceDrafts.fingerprint(p))
        .isNotEqualTo(AssistantInvoiceDrafts.fingerprint(build(req(42L, List.of(2L)))));
    assertThat(AssistantInvoiceDrafts.fingerprint(p)).hasSize(64);
  }

  // ---------------------------------------------------------------------------------------------

  @Test
  void theRequest_carriesTheReceiverIdentityLikeTheBillingScreen() {
    when(clients.getById(TENANT, 46))
        .thenReturn(client(46, "EMPRESA", "80000005-6", null, null, "e@e.com"));
    when(clients.getById(TENANT, 47)).thenReturn(client(47, "JUAN", null, "1234567", null, null));
    InvoiceDraftPayload ruc = build(req(46L, List.of(1L))).withPayment("CASH", null);
    InvoiceDraftPayload cedula = build(req(47L, List.of(1L))).withPayment("CASH", null);
    InvoiceDraftPayload none = build(req(42L, List.of(1L))).withPayment("CASH", null);

    InvoiceCreateRequest forRuc = drafts.toRequest(TENANT, ruc);
    assertThat(forRuc.clientRucOverride()).isEqualTo("80000005-6");
    assertThat(forRuc.clientTaxpayerTypeOverride()).isEqualTo("PERSONA_FISICA");
    assertThat(forRuc.clientIdentityDocumentOverride()).isNull();

    InvoiceCreateRequest forCedula = drafts.toRequest(TENANT, cedula);
    assertThat(forCedula.clientIdentityDocumentOverride()).isEqualTo("1234567");
    assertThat(forCedula.clientIdentityDocumentTypeOverride()).isEqualTo("CEDULA_PARAGUAYA");
    assertThat(forCedula.clientRucOverride()).isNull();

    InvoiceCreateRequest forNone = drafts.toRequest(TENANT, none);
    assertThat(forNone.clientRucOverride()).isNull();
    assertThat(forNone.clientIdentityDocumentOverride()).isNull();
  }

  @Test
  void theRequest_hasTheLinesAndOnePaymentForTheWholeTotal() {
    InvoiceDraftPayload p =
        build(req(42L, List.of(1L, 2L))).withPayment("CREDIT_CARD", "VISA").withEmail("a@b.com");

    InvoiceCreateRequest r = drafts.toRequest(TENANT, p);

    assertThat(r.clientId()).isEqualTo(42L);
    assertThat(r.lines()).hasSize(2);
    assertThat(r.lines().get(0).unitPrice()).isEqualByComparingTo("50000");
    assertThat(r.payments()).hasSize(1);
    assertThat(r.payments().get(0).method()).isEqualTo("CREDIT_CARD");
    assertThat(r.payments().get(0).amount()).isEqualByComparingTo("170000");
    assertThat(r.payments().get(0).cardBrand()).isEqualTo("VISA");
    assertThat(r.email()).isEqualTo("a@b.com");
  }

  @Test
  void repricing_picksUpTheCatalogsNewPrice() {
    InvoiceDraftPayload old = build(req(42L, List.of(1L)));
    when(catalog.listServices(eq(TENANT), eq(Optional.empty()), any(), eq("SERVICE")))
        .thenReturn(List.of(service(1, "Corte", 65_000, true)));

    InvoiceDraftPayload fresh = drafts.reprice(TENANT, old);

    assertThat(fresh.total()).isEqualByComparingTo("65000");
    assertThat(AssistantInvoiceDrafts.fingerprint(fresh))
        .isNotEqualTo(AssistantInvoiceDrafts.fingerprint(old));
    assertThat(Map.of("kept", fresh.clientName())).containsEntry("kept", "MARIA GOMEZ");
  }

  private static List<AssistantDraftService.LinePrice> price(int index, String unitPrice) {
    return List.of(new AssistantDraftService.LinePrice(index, new BigDecimal(unitPrice)));
  }

  @Test
  void editingAUnitPrice_recalculatesTheLineAndTheTotal_andMarksItAsEdited() {
    InvoiceDraftPayload p = build(req(42L, List.of(1L, 2L))); // 50.000 + 120.000

    InvoiceDraftPayload edited = drafts.complete(p, null, null, null, price(1, "100000"));

    assertThat(edited.lines().get(1).unitPrice()).isEqualByComparingTo("100000");
    assertThat(edited.lines().get(1).lineTotal()).isEqualByComparingTo("100000");
    assertThat(edited.lines().get(1).priceEdited()).isTrue();
    assertThat(edited.lines().get(0).priceEdited()).isNull();
    assertThat(edited.total()).isEqualByComparingTo("150000");
    // The payment the card will issue follows the total (toRequest uses it).
    assertThat(
            drafts.toRequest(TENANT, edited.withPayment("CASH", null)).payments().get(0).amount())
        .isEqualByComparingTo("150000");
    assertThat(AssistantInvoiceDrafts.fingerprint(edited))
        .isNotEqualTo(AssistantInvoiceDrafts.fingerprint(p));
  }

  @Test
  void aUnitPrice_mustBeAWholePositiveAmountOnAnExistingLine() {
    InvoiceDraftPayload p = build(req(42L, List.of(1L)));

    for (List<AssistantDraftService.LinePrice> bad :
        List.of(
            price(0, "0"),
            price(0, "-5000"),
            price(0, "1500.50"),
            price(0, "1000000000"),
            price(3, "5000"),
            price(-1, "5000"),
            List.of(new AssistantDraftService.LinePrice(null, new BigDecimal("5000"))),
            List.of(new AssistantDraftService.LinePrice(0, null)))) {
      assertThatThrownBy(() -> drafts.complete(p, null, null, null, bad))
          .isInstanceOf(AssistantDraftException.class)
          .hasMessage("ASSISTANT_DRAFT_INVALID_PRICE");
    }
    assertThat(drafts.complete(p, null, null, null, price(0, "50000.00")).total())
        .isEqualByComparingTo("50000");
  }

  @Test
  void repricing_keepsAPriceThePersonTyped_whileRefreshingTheRest() {
    InvoiceDraftPayload edited =
        drafts.complete(build(req(42L, List.of(1L, 2L))), null, null, null, price(0, "45000"));
    when(catalog.listServices(eq(TENANT), eq(Optional.empty()), any(), eq("SERVICE")))
        .thenReturn(
            List.of(service(1, "Corte", 65_000, true), service(2, "Tintura", 130_000, true)));

    InvoiceDraftPayload fresh = drafts.reprice(TENANT, edited);

    assertThat(fresh.lines().get(0).unitPrice()).isEqualByComparingTo("45000"); // theirs
    assertThat(fresh.lines().get(0).priceEdited()).isTrue();
    assertThat(fresh.lines().get(1).unitPrice()).isEqualByComparingTo("130000"); // the catalog's
    assertThat(fresh.total()).isEqualByComparingTo("175000");
  }

  @Test
  void repricing_withNothingNewInTheCatalog_isStableAfterAnEdit() {
    InvoiceDraftPayload edited =
        drafts.complete(build(req(42L, List.of(1L))), null, null, null, price(0, "45000"));

    InvoiceDraftPayload fresh = drafts.reprice(TENANT, edited);

    // No false «the price changed» just because the person's price differs from the catalog's.
    assertThat(AssistantInvoiceDrafts.fingerprint(fresh))
        .isEqualTo(AssistantInvoiceDrafts.fingerprint(edited));
  }

  // ---------------------------------------------------------------------------------------------

  private static ServiceRecordLine recordLine(
      long serviceId, String description, Integer price, int qty, Long professionalId) {
    ServiceRecordLine l = mock(ServiceRecordLine.class);
    SalonService s = mock(SalonService.class);
    when(s.getId()).thenReturn(serviceId);
    when(l.getSalonService()).thenReturn(s);
    when(l.getDescription()).thenReturn(description);
    when(l.getUnitPrice()).thenReturn(price == null ? null : BigDecimal.valueOf(price));
    when(l.getQuantity()).thenReturn(qty);
    if (professionalId != null) {
      Professional p = mock(Professional.class);
      when(p.getId()).thenReturn(professionalId);
      when(p.getDisplayName()).thenReturn("Lu");
      when(l.getProfessional()).thenReturn(p);
    }
    return l;
  }

  private AppointmentResponse appointment(long id, long serviceId, String status, Long invoiceId) {
    return new AppointmentResponse(
        id,
        42L,
        "MARIA GOMEZ",
        9,
        "Lu",
        serviceId,
        "Servicio",
        30,
        Instant.now().toString(),
        Instant.now().plusSeconds(1800).toString(),
        status,
        null,
        null,
        false,
        null,
        invoiceId);
  }
}
