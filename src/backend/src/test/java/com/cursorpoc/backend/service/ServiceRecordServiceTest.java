package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.ServiceRecord;
import com.cursorpoc.backend.domain.ServiceRecordLine;
import com.cursorpoc.backend.domain.ServiceRecordTip;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.ServiceRecordStatus;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.repository.ServiceRecordRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.ServiceRecordLineRequest;
import com.cursorpoc.backend.web.dto.ServiceRecordRequest;
import com.cursorpoc.backend.web.dto.ServiceRecordResponse;
import com.cursorpoc.backend.web.dto.ServiceRecordTipRequest;
import com.cursorpoc.backend.web.dto.ServiceRecordVoidRequest;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

@ExtendWith(MockitoExtension.class)
class ServiceRecordServiceTest {

  @Mock private ServiceRecordRepository serviceRecordRepository;
  @Mock private ClientRepository clientRepository;
  @Mock private ProfessionalRepository professionalRepository;
  @Mock private SalonServiceRepository salonServiceRepository;
  @Mock private TenantRepository tenantRepository;
  @Mock private InvoiceRepository invoiceRepository;
  @Spy private FemmeTimeProperties timeProperties = new FemmeTimeProperties();

  @InjectMocks private ServiceRecordService serviceRecordService;

  private Tenant tenant;
  private Client client;
  private Professional professional;
  private SalonService salonService;

  @BeforeEach
  void setUp() {
    tenant = new Tenant();
    tenant.setId(1L);
    tenant.setName("Demo");

    client = new Client();
    client.setId(7L);
    client.setTenant(tenant);
    client.setFullName("Ana García");

    professional = new Professional();
    professional.setId(3L);
    professional.setTenant(tenant);
    professional.setFullName("Bea Stylist");

    salonService = new SalonService();
    salonService.setId(9L);
    salonService.setTenant(tenant);
    salonService.setName("Corte");
    salonService.setPriceMinor(new BigDecimal("50000"));
  }

  @Test
  void createServiceRecord_success_computesTotalAndTips() {
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    when(clientRepository.findByIdAndTenant_Id(7L, 1L)).thenReturn(Optional.of(client));
    when(salonServiceRepository.findByIdAndTenant_Id(9L, 1L)).thenReturn(Optional.of(salonService));
    when(professionalRepository.findByIdAndTenant_Id(3L, 1L)).thenReturn(Optional.of(professional));
    when(serviceRecordRepository.save(org.mockito.ArgumentMatchers.any(ServiceRecord.class)))
        .thenAnswer(
            inv -> {
              ServiceRecord r = inv.getArgument(0);
              r.setId(100L);
              return r;
            });

    var line = new ServiceRecordLineRequest(9L, 3L, 1, new BigDecimal("50000"));
    var tip = new ServiceRecordTipRequest(3L, new BigDecimal("5000"));
    var request = new ServiceRecordRequest(7L, List.of(line), List.of(tip));

    ServiceRecordResponse result = serviceRecordService.createServiceRecord(1L, request);

    assertThat(result.status()).isEqualTo(ServiceRecordStatus.OPEN.name());
    assertThat(result.totalAmount()).isEqualByComparingTo(new BigDecimal("50000.00"));
    assertThat(result.tipsTotal()).isEqualByComparingTo(new BigDecimal("5000.00"));
    assertThat(result.lines()).hasSize(1);
    assertThat(result.lines().get(0).quantity()).isEqualTo(1);
    assertThat(result.lines().get(0).lineTotal()).isEqualByComparingTo(new BigDecimal("50000.00"));
    assertThat(result.tips()).hasSize(1);
    assertThat(result.tips().get(0).professionalId()).isEqualTo(3L);
  }

  @Test
  void createServiceRecord_withQuantityAndCustomUnitPrice_computesLineTotalAndTotal() {
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    when(clientRepository.findByIdAndTenant_Id(7L, 1L)).thenReturn(Optional.of(client));
    when(salonServiceRepository.findByIdAndTenant_Id(9L, 1L)).thenReturn(Optional.of(salonService));
    when(professionalRepository.findByIdAndTenant_Id(3L, 1L)).thenReturn(Optional.of(professional));
    when(serviceRecordRepository.save(org.mockito.ArgumentMatchers.any(ServiceRecord.class)))
        .thenAnswer(
            inv -> {
              ServiceRecord r = inv.getArgument(0);
              r.setId(101L);
              return r;
            });

    var line = new ServiceRecordLineRequest(9L, 3L, 3, new BigDecimal("40000"));
    var request = new ServiceRecordRequest(7L, List.of(line), List.of());

    ServiceRecordResponse result = serviceRecordService.createServiceRecord(1L, request);

    assertThat(result.lines().get(0).quantity()).isEqualTo(3);
    assertThat(result.lines().get(0).unitPrice()).isEqualByComparingTo(new BigDecimal("40000.00"));
    assertThat(result.lines().get(0).lineTotal()).isEqualByComparingTo(new BigDecimal("120000.00"));
    assertThat(result.totalAmount()).isEqualByComparingTo(new BigDecimal("120000.00"));
  }

  @Test
  void createServiceRecord_quantityLessThanOne_rejected() {
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    when(clientRepository.findByIdAndTenant_Id(7L, 1L)).thenReturn(Optional.of(client));

    var line = new ServiceRecordLineRequest(9L, 3L, 0, new BigDecimal("50000"));
    var request = new ServiceRecordRequest(7L, List.of(line), List.of());

    assertThatThrownBy(() -> serviceRecordService.createServiceRecord(1L, request))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SERVICE_RECORD_LINE_QUANTITY_INVALID");
  }

  @Test
  void createServiceRecord_unitPriceZeroOrNegative_rejected() {
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    when(clientRepository.findByIdAndTenant_Id(7L, 1L)).thenReturn(Optional.of(client));

    var line = new ServiceRecordLineRequest(9L, 3L, 1, BigDecimal.ZERO);
    var request = new ServiceRecordRequest(7L, List.of(line), List.of());

    assertThatThrownBy(() -> serviceRecordService.createServiceRecord(1L, request))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SERVICE_RECORD_LINE_UNIT_PRICE_INVALID");
  }

  @Test
  void createServiceRecord_noLines_allowed() {
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    when(clientRepository.findByIdAndTenant_Id(7L, 1L)).thenReturn(Optional.of(client));
    when(serviceRecordRepository.save(org.mockito.ArgumentMatchers.any(ServiceRecord.class)))
        .thenAnswer(
            inv -> {
              ServiceRecord r = inv.getArgument(0);
              r.setId(103L);
              return r;
            });

    var request = new ServiceRecordRequest(7L, List.of(), List.of());

    ServiceRecordResponse result = serviceRecordService.createServiceRecord(1L, request);

    assertThat(result.lines()).isEmpty();
    assertThat(result.totalAmount()).isEqualByComparingTo(BigDecimal.ZERO);
  }

  @Test
  void createServiceRecord_lineWithoutProfessional_allowed() {
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    when(clientRepository.findByIdAndTenant_Id(7L, 1L)).thenReturn(Optional.of(client));
    when(salonServiceRepository.findByIdAndTenant_Id(9L, 1L)).thenReturn(Optional.of(salonService));
    when(serviceRecordRepository.save(org.mockito.ArgumentMatchers.any(ServiceRecord.class)))
        .thenAnswer(
            inv -> {
              ServiceRecord r = inv.getArgument(0);
              r.setId(104L);
              return r;
            });

    var line = new ServiceRecordLineRequest(9L, null, 1, new BigDecimal("50000"));
    var request = new ServiceRecordRequest(7L, List.of(line), List.of());

    ServiceRecordResponse result = serviceRecordService.createServiceRecord(1L, request);

    assertThat(result.lines()).hasSize(1);
    assertThat(result.lines().get(0).professionalId()).isNull();
    assertThat(result.lines().get(0).professionalName()).isNull();
  }

  @Test
  void createServiceRecord_lineWithoutUnitPriceOrQuantity_defaultsApplied() {
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    when(clientRepository.findByIdAndTenant_Id(7L, 1L)).thenReturn(Optional.of(client));
    when(salonServiceRepository.findByIdAndTenant_Id(9L, 1L)).thenReturn(Optional.of(salonService));
    when(serviceRecordRepository.save(org.mockito.ArgumentMatchers.any(ServiceRecord.class)))
        .thenAnswer(
            inv -> {
              ServiceRecord r = inv.getArgument(0);
              r.setId(105L);
              return r;
            });

    var line = new ServiceRecordLineRequest(9L, null, null, null);
    var request = new ServiceRecordRequest(7L, List.of(line), List.of());

    ServiceRecordResponse result = serviceRecordService.createServiceRecord(1L, request);

    assertThat(result.lines().get(0).quantity()).isEqualTo(1);
    assertThat(result.lines().get(0).unitPrice()).isEqualByComparingTo(BigDecimal.ZERO);
    assertThat(result.totalAmount()).isEqualByComparingTo(BigDecimal.ZERO);
  }

  @Test
  void listServiceRecords_includesServicesAndProfessionalsSummary() {
    ServiceRecord record = new ServiceRecord();
    record.setId(55L);
    record.setTenant(tenant);
    record.setClient(client);
    record.setStatus(ServiceRecordStatus.OPEN);
    record.setTotalAmount(new BigDecimal("100000"));
    record.setCreatedAt(Instant.parse("2026-10-26T13:30:00Z"));
    SalonService brushing = new SalonService();
    brushing.setId(10L);
    brushing.setName("Brushing");
    Professional ana = new Professional();
    ana.setId(4L);
    ana.setFullName("Ana");
    for (Object[] spec :
        new Object[][] {
          {salonService, professional},
          {brushing, ana},
          {salonService, professional},
          {brushing, null}
        }) {
      ServiceRecordLine l = new ServiceRecordLine();
      l.setServiceRecord(record);
      l.setSalonService((SalonService) spec[0]);
      l.setProfessional((Professional) spec[1]);
      record.getLines().add(l);
    }
    when(serviceRecordRepository.findByTenantWithFiltersPaged(
            org.mockito.ArgumentMatchers.eq(1L),
            org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.isNull(),
            org.mockito.ArgumentMatchers.isNull(),
            org.mockito.ArgumentMatchers.isNull(),
            org.mockito.ArgumentMatchers.any()))
        .thenReturn(new org.springframework.data.domain.PageImpl<>(List.of(record)));

    var page = serviceRecordService.listServiceRecords(1L, null, null, null, null, null, 0, 10);

    assertThat(page.content()).hasSize(1);
    assertThat(page.content().get(0).servicesSummary()).isEqualTo("Corte, Brushing");
    assertThat(page.content().get(0).professionalsSummary()).isEqualTo("Bea Stylist, Ana");
  }

  @Test
  void toDetailDto_includesClientRuc() {
    client.setRuc("80000005-6");
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    when(clientRepository.findByIdAndTenant_Id(7L, 1L)).thenReturn(Optional.of(client));
    when(salonServiceRepository.findByIdAndTenant_Id(9L, 1L)).thenReturn(Optional.of(salonService));
    when(professionalRepository.findByIdAndTenant_Id(3L, 1L)).thenReturn(Optional.of(professional));
    when(serviceRecordRepository.save(org.mockito.ArgumentMatchers.any(ServiceRecord.class)))
        .thenAnswer(
            inv -> {
              ServiceRecord r = inv.getArgument(0);
              r.setId(102L);
              return r;
            });

    var line = new ServiceRecordLineRequest(9L, 3L, 1, new BigDecimal("50000"));
    var request = new ServiceRecordRequest(7L, List.of(line), List.of());

    ServiceRecordResponse result = serviceRecordService.createServiceRecord(1L, request);

    assertThat(result.clientRuc()).isEqualTo("80000005-6");
  }

  @Test
  void createServiceRecord_tipForProfessionalNotInLines_rejected() {
    when(tenantRepository.findById(1L)).thenReturn(Optional.of(tenant));
    when(clientRepository.findByIdAndTenant_Id(7L, 1L)).thenReturn(Optional.of(client));
    when(salonServiceRepository.findByIdAndTenant_Id(9L, 1L)).thenReturn(Optional.of(salonService));
    when(professionalRepository.findByIdAndTenant_Id(3L, 1L)).thenReturn(Optional.of(professional));

    var line = new ServiceRecordLineRequest(9L, 3L, 1, new BigDecimal("50000"));
    var tip = new ServiceRecordTipRequest(99L, new BigDecimal("5000"));
    var request = new ServiceRecordRequest(7L, List.of(line), List.of(tip));

    assertThatThrownBy(() -> serviceRecordService.createServiceRecord(1L, request))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("TIP_PROFESSIONAL_NOT_IN_LINES");
  }

  @Test
  void updateServiceRecord_whenNotOpen_rejected() {
    ServiceRecord closed = new ServiceRecord();
    closed.setId(50L);
    closed.setTenant(tenant);
    closed.setClient(client);
    closed.setStatus(ServiceRecordStatus.CLOSED);
    closed.setCreatedAt(Instant.now());
    when(serviceRecordRepository.findByIdAndTenant_Id(50L, 1L)).thenReturn(Optional.of(closed));

    var line = new ServiceRecordLineRequest(9L, 3L, 1, new BigDecimal("50000"));
    var request = new ServiceRecordRequest(7L, List.of(line), List.of());

    assertThatThrownBy(() -> serviceRecordService.updateServiceRecord(1L, 50L, request))
        .isInstanceOf(ResponseStatusException.class)
        .hasFieldOrPropertyWithValue("statusCode", HttpStatus.CONFLICT)
        .hasMessageContaining("SERVICE_RECORD_NOT_OPEN");
  }

  @Test
  void updateServiceRecord_keepsSameProfessionalTip_updatesInPlaceWithoutDuplicateKey() {
    Professional secondProfessional = new Professional();
    secondProfessional.setId(4L);
    secondProfessional.setTenant(tenant);
    secondProfessional.setFullName("Second Prof");

    SalonService secondService = new SalonService();
    secondService.setId(10L);
    secondService.setTenant(tenant);
    secondService.setName("Color");
    secondService.setPriceMinor(new BigDecimal("30000"));

    ServiceRecord open = new ServiceRecord();
    open.setId(55L);
    open.setTenant(tenant);
    open.setClient(client);
    open.setStatus(ServiceRecordStatus.OPEN);
    open.setCreatedAt(Instant.now());

    ServiceRecordLine existingLine = new ServiceRecordLine();
    existingLine.setServiceRecord(open);
    existingLine.setSalonService(salonService);
    existingLine.setProfessional(professional);
    existingLine.setDescription(salonService.getName());
    existingLine.setUnitPrice(new BigDecimal("50000.00"));
    existingLine.setQuantity(1);
    open.getLines().add(existingLine);

    ServiceRecordTip existingTip = new ServiceRecordTip();
    existingTip.setServiceRecord(open);
    existingTip.setProfessional(professional);
    existingTip.setAmount(new BigDecimal("5000.00"));
    open.getTips().add(existingTip);

    when(serviceRecordRepository.findByIdAndTenant_Id(55L, 1L)).thenReturn(Optional.of(open));
    when(clientRepository.findByIdAndTenant_Id(7L, 1L)).thenReturn(Optional.of(client));
    when(salonServiceRepository.findByIdAndTenant_Id(9L, 1L)).thenReturn(Optional.of(salonService));
    when(salonServiceRepository.findByIdAndTenant_Id(10L, 1L))
        .thenReturn(Optional.of(secondService));
    when(professionalRepository.findByIdAndTenant_Id(3L, 1L)).thenReturn(Optional.of(professional));
    when(professionalRepository.findByIdAndTenant_Id(4L, 1L))
        .thenReturn(Optional.of(secondProfessional));

    // Add a second line for a different professional while keeping the first professional's
    // tip — the same natural key (record, professional) must survive as one row, not be
    // deleted-then-recreated (which would violate the DB's unique constraint).
    var lineKeep = new ServiceRecordLineRequest(9L, 3L, 1, new BigDecimal("50000"));
    var lineNew = new ServiceRecordLineRequest(10L, 4L, 1, new BigDecimal("30000"));
    var tipKeep = new ServiceRecordTipRequest(3L, new BigDecimal("7000"));
    var request = new ServiceRecordRequest(7L, List.of(lineKeep, lineNew), List.of(tipKeep));

    ServiceRecordResponse result = serviceRecordService.updateServiceRecord(1L, 55L, request);

    assertThat(result.lines()).hasSize(2);
    assertThat(result.tips()).hasSize(1);
    assertThat(result.tips().get(0).professionalId()).isEqualTo(3L);
    assertThat(result.tips().get(0).amount()).isEqualByComparingTo(new BigDecimal("7000.00"));
    assertThat(open.getTips()).hasSize(1);
    assertThat(open.getTips().get(0)).isSameAs(existingTip);
  }

  @Test
  void updateServiceRecord_removesTipForDroppedProfessional() {
    ServiceRecord open = new ServiceRecord();
    open.setId(56L);
    open.setTenant(tenant);
    open.setClient(client);
    open.setStatus(ServiceRecordStatus.OPEN);
    open.setCreatedAt(Instant.now());

    ServiceRecordLine existingLine = new ServiceRecordLine();
    existingLine.setServiceRecord(open);
    existingLine.setSalonService(salonService);
    existingLine.setProfessional(professional);
    existingLine.setDescription(salonService.getName());
    existingLine.setUnitPrice(new BigDecimal("50000.00"));
    existingLine.setQuantity(1);
    open.getLines().add(existingLine);

    ServiceRecordTip existingTip = new ServiceRecordTip();
    existingTip.setServiceRecord(open);
    existingTip.setProfessional(professional);
    existingTip.setAmount(new BigDecimal("5000.00"));
    open.getTips().add(existingTip);

    when(serviceRecordRepository.findByIdAndTenant_Id(56L, 1L)).thenReturn(Optional.of(open));
    when(clientRepository.findByIdAndTenant_Id(7L, 1L)).thenReturn(Optional.of(client));
    when(salonServiceRepository.findByIdAndTenant_Id(9L, 1L)).thenReturn(Optional.of(salonService));
    when(professionalRepository.findByIdAndTenant_Id(3L, 1L)).thenReturn(Optional.of(professional));

    // Same line, but no tips in the request this time — the existing tip must be removed.
    var line = new ServiceRecordLineRequest(9L, 3L, 1, new BigDecimal("50000"));
    var request = new ServiceRecordRequest(7L, List.of(line), List.of());

    ServiceRecordResponse result = serviceRecordService.updateServiceRecord(1L, 56L, request);

    assertThat(result.tips()).isEmpty();
    assertThat(open.getTips()).isEmpty();
  }

  @Test
  void voidServiceRecord_whenOpen_transitionsToVoided() {
    ServiceRecord open = new ServiceRecord();
    open.setId(60L);
    open.setTenant(tenant);
    open.setClient(client);
    open.setStatus(ServiceRecordStatus.OPEN);
    open.setCreatedAt(Instant.now());
    when(serviceRecordRepository.findByIdAndTenant_Id(60L, 1L)).thenReturn(Optional.of(open));

    ServiceRecordResponse result =
        serviceRecordService.voidServiceRecord(
            1L, 60L, new ServiceRecordVoidRequest("Cliente canceló"));

    assertThat(result.status()).isEqualTo(ServiceRecordStatus.VOIDED.name());
    assertThat(open.getVoidReason()).isEqualTo("Cliente canceló");
  }

  @Test
  void voidServiceRecord_whenAlreadyClosed_rejected() {
    ServiceRecord closed = new ServiceRecord();
    closed.setId(70L);
    closed.setTenant(tenant);
    closed.setClient(client);
    closed.setStatus(ServiceRecordStatus.CLOSED);
    closed.setCreatedAt(Instant.now());
    when(serviceRecordRepository.findByIdAndTenant_Id(70L, 1L)).thenReturn(Optional.of(closed));

    assertThatThrownBy(
            () ->
                serviceRecordService.voidServiceRecord(
                    1L, 70L, new ServiceRecordVoidRequest("Motivo")))
        .isInstanceOf(ResponseStatusException.class)
        .hasFieldOrPropertyWithValue("statusCode", HttpStatus.CONFLICT)
        .hasMessageContaining("SERVICE_RECORD_NOT_OPEN");
  }

  // ── Professional view: open fichas of today, no money ─────────────────────────────────────

  private ServiceRecord openRecordToday(long id) {
    ServiceRecord r = new ServiceRecord();
    r.setId(id);
    r.setTenant(tenant);
    r.setClient(client);
    r.setStatus(ServiceRecordStatus.OPEN);
    r.setCreatedAt(Instant.now());
    r.setTotalAmount(new BigDecimal("50000"));
    ServiceRecordLine line = new ServiceRecordLine();
    line.setServiceRecord(r);
    line.setSalonService(salonService);
    line.setProfessional(professional);
    line.setDescription("Corte");
    line.setQuantity(1);
    line.setUnitPrice(new BigDecimal("40000"));
    r.getLines().add(line);
    ServiceRecordTip tip = new ServiceRecordTip();
    tip.setServiceRecord(r);
    tip.setProfessional(professional);
    tip.setAmount(new BigDecimal("5000"));
    r.getTips().add(tip);
    return r;
  }

  @Test
  void professionalGet_returnsOpenRecordOfTodayWithoutAnyAmount() {
    ServiceRecord open = openRecordToday(60L);
    when(serviceRecordRepository.findByIdAndTenant_Id(60L, 1L)).thenReturn(Optional.of(open));

    ServiceRecordResponse result = serviceRecordService.getOpenTodayForProfessional(1L, 60L);

    assertThat(result.totalAmount()).isNull();
    assertThat(result.tipsTotal()).isNull();
    assertThat(result.clientRuc()).isNull();
    assertThat(result.tips()).isEmpty();
    assertThat(result.lines()).hasSize(1);
    assertThat(result.lines().get(0).unitPrice()).isNull();
    assertThat(result.lines().get(0).lineTotal()).isNull();
    assertThat(result.lines().get(0).quantity()).isEqualTo(1);
  }

  @Test
  void professionalGet_recordFromAnotherDay_isNotFound() {
    ServiceRecord old = openRecordToday(61L);
    old.setCreatedAt(Instant.now().minus(java.time.Duration.ofDays(2)));
    when(serviceRecordRepository.findByIdAndTenant_Id(61L, 1L)).thenReturn(Optional.of(old));

    assertThatThrownBy(() -> serviceRecordService.getOpenTodayForProfessional(1L, 61L))
        .isInstanceOf(ResponseStatusException.class)
        .hasFieldOrPropertyWithValue("statusCode", HttpStatus.NOT_FOUND);
  }

  @Test
  void professionalGet_closedRecord_isRejected() {
    ServiceRecord closed = openRecordToday(62L);
    closed.setStatus(ServiceRecordStatus.CLOSED);
    when(serviceRecordRepository.findByIdAndTenant_Id(62L, 1L)).thenReturn(Optional.of(closed));

    assertThatThrownBy(() -> serviceRecordService.getOpenTodayForProfessional(1L, 62L))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SERVICE_RECORD_NOT_OPEN");
  }

  @Test
  void professionalUpdate_ignoresPricesAndTips_keepsPriceOfKeptServiceAndUsesCatalogForNew() {
    SalonService color = new SalonService();
    color.setId(10L);
    color.setTenant(tenant);
    color.setName("Color");
    color.setPriceMinor(new BigDecimal("30000"));

    ServiceRecord open = openRecordToday(63L);
    when(serviceRecordRepository.findByIdAndTenant_Id(63L, 1L)).thenReturn(Optional.of(open));
    when(salonServiceRepository.findByIdAndTenant_Id(9L, 1L)).thenReturn(Optional.of(salonService));
    when(salonServiceRepository.findByIdAndTenant_Id(10L, 1L)).thenReturn(Optional.of(color));
    when(professionalRepository.findByIdAndTenant_Id(3L, 1L)).thenReturn(Optional.of(professional));

    // The request tries to set a price (999) and a tip: both must be ignored.
    var kept = new ServiceRecordLineRequest(9L, 3L, 2, new BigDecimal("999"));
    var added = new ServiceRecordLineRequest(10L, 3L, 1, new BigDecimal("999"));
    var tip = new ServiceRecordTipRequest(3L, new BigDecimal("999"));
    var request = new ServiceRecordRequest(99L, List.of(kept, added), List.of(tip));

    ServiceRecordResponse result =
        serviceRecordService.updateServicesAsProfessional(1L, 63L, request);

    // The response carries no money…
    assertThat(result.totalAmount()).isNull();
    assertThat(result.lines()).hasSize(2);
    // …but the stored record: kept service keeps 40.000, the new one takes the catalog 30.000.
    assertThat(open.getLines().get(0).getUnitPrice()).isEqualByComparingTo("40000");
    assertThat(open.getLines().get(0).getQuantity()).isEqualTo(2);
    assertThat(open.getLines().get(1).getUnitPrice()).isEqualByComparingTo("30000");
    assertThat(open.getTotalAmount()).isEqualByComparingTo("110000");
    // The client is untouched and the existing tip keeps its amount.
    assertThat(open.getClient().getId()).isEqualTo(7L);
    assertThat(open.getTips()).hasSize(1);
    assertThat(open.getTips().get(0).getAmount()).isEqualByComparingTo("5000");
  }

  @Test
  void professionalUpdate_removingTheTippedProfessionalsLines_dropsHerTip() {
    ServiceRecord open = openRecordToday(64L);
    when(serviceRecordRepository.findByIdAndTenant_Id(64L, 1L)).thenReturn(Optional.of(open));
    when(salonServiceRepository.findByIdAndTenant_Id(9L, 1L)).thenReturn(Optional.of(salonService));

    // The only line is re-saved without a professional: nobody is left to hold the tip.
    var line = new ServiceRecordLineRequest(9L, null, 1, null);
    var request = new ServiceRecordRequest(7L, List.of(line), null);

    serviceRecordService.updateServicesAsProfessional(1L, 64L, request);

    assertThat(open.getTips()).isEmpty();
    assertThat(open.getLines()).hasSize(1);
  }
}
