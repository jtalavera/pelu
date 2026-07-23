package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

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
}
