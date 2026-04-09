package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.domain.Appointment;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.ServiceCategory;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.AppointmentStatus;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.AppointmentCreateRequest;
import com.cursorpoc.backend.web.dto.AppointmentStatusUpdateRequest;
import com.cursorpoc.backend.web.dto.AppointmentUpdateRequest;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

@ExtendWith(MockitoExtension.class)
class AppointmentServiceTest {

  @Mock private AppointmentRepository appointmentRepository;
  @Mock private TenantRepository tenantRepository;
  @Mock private ProfessionalRepository professionalRepository;
  @Mock private SalonServiceRepository salonServiceRepository;
  @Mock private ClientRepository clientRepository;

  @InjectMocks private AppointmentService service;

  private Tenant tenant;
  private Professional professional;
  private SalonService salonService;
  private Client client;
  private final AtomicLong ids = new AtomicLong(1);

  private static final long TENANT_ID = 1L;
  private static final long PROFESSIONAL_ID = 10L;
  private static final long SERVICE_ID = 20L;
  private static final long CLIENT_ID = 30L;
  private static final String START_AT = "2026-04-10T09:00:00Z";

  @BeforeEach
  void setUp() {
    tenant = new Tenant();
    tenant.setId(TENANT_ID);
    tenant.setName("Demo");

    professional = new Professional();
    professional.setId(PROFESSIONAL_ID);
    professional.setTenant(tenant);
    professional.setFullName("Ana Gomez");
    professional.setActive(true);

    ServiceCategory category = new ServiceCategory();
    category.setId(1L);
    category.setName("Hair");

    salonService = new SalonService();
    salonService.setId(SERVICE_ID);
    salonService.setTenant(tenant);
    salonService.setName("Haircut");
    salonService.setDurationMinutes(60);
    salonService.setPriceMinor(BigDecimal.valueOf(50000));
    salonService.setCategory(category);
    salonService.setActive(true);

    client = new Client();
    client.setId(CLIENT_ID);
    client.setTenant(tenant);
    client.setFullName("Maria Lopez");
    client.setActive(true);

    lenient().when(tenantRepository.findById(TENANT_ID)).thenReturn(Optional.of(tenant));
    lenient()
        .when(professionalRepository.findByIdAndTenant_Id(PROFESSIONAL_ID, TENANT_ID))
        .thenReturn(Optional.of(professional));
    lenient()
        .when(salonServiceRepository.findByIdAndTenant_Id(SERVICE_ID, TENANT_ID))
        .thenReturn(Optional.of(salonService));
    lenient()
        .when(clientRepository.findByIdAndTenant_Id(CLIENT_ID, TENANT_ID))
        .thenReturn(Optional.of(client));
    lenient()
        .when(appointmentRepository.save(any(Appointment.class)))
        .thenAnswer(
            inv -> {
              Appointment a = inv.getArgument(0);
              if (a.getId() == null) {
                a.setId(ids.getAndIncrement());
              }
              return a;
            });
  }

  @Test
  void create_withRegisteredClient_setsStatusPending() {
    when(appointmentRepository.countOverlapping(
            eq(TENANT_ID),
            eq(PROFESSIONAL_ID),
            any(Instant.class),
            any(Instant.class),
            eq(null),
            eq(AppointmentStatus.CANCELLED)))
        .thenReturn(0L);

    var req = new AppointmentCreateRequest(CLIENT_ID, PROFESSIONAL_ID, SERVICE_ID, START_AT);
    var res = service.create(TENANT_ID, req);

    assertThat(res.status()).isEqualTo("PENDING");
    assertThat(res.clientId()).isEqualTo(CLIENT_ID);
    assertThat(res.clientName()).isEqualTo("Maria Lopez");
    assertThat(res.professionalName()).isEqualTo("Ana Gomez");
    assertThat(res.serviceName()).isEqualTo("Haircut");
    assertThat(res.durationMinutes()).isEqualTo(60);
  }

  @Test
  void create_withOccasionalClient_clientIsNull() {
    when(appointmentRepository.countOverlapping(
            eq(TENANT_ID),
            eq(PROFESSIONAL_ID),
            any(Instant.class),
            any(Instant.class),
            eq(null),
            eq(AppointmentStatus.CANCELLED)))
        .thenReturn(0L);

    var req = new AppointmentCreateRequest(null, PROFESSIONAL_ID, SERVICE_ID, START_AT);
    var res = service.create(TENANT_ID, req);

    assertThat(res.status()).isEqualTo("PENDING");
    assertThat(res.clientId()).isNull();
    assertThat(res.clientName()).isNull();
  }

  @Test
  void create_withOverlap_throwsConflict() {
    when(appointmentRepository.countOverlapping(
            eq(TENANT_ID),
            eq(PROFESSIONAL_ID),
            any(Instant.class),
            any(Instant.class),
            eq(null),
            eq(AppointmentStatus.CANCELLED)))
        .thenReturn(1L);

    var req = new AppointmentCreateRequest(null, PROFESSIONAL_ID, SERVICE_ID, START_AT);
    assertThatThrownBy(() -> service.create(TENANT_ID, req))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            e -> assertThat(((ResponseStatusException) e).getStatusCode().value()).isEqualTo(409));
  }

  @Test
  void create_withInvalidDate_throwsBadRequest() {
    var req = new AppointmentCreateRequest(null, PROFESSIONAL_ID, SERVICE_ID, "not-a-date");
    assertThatThrownBy(() -> service.create(TENANT_ID, req))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            e -> assertThat(((ResponseStatusException) e).getStatusCode().value()).isEqualTo(400));
  }

  @Test
  void create_computesEndAtFromDuration() {
    salonService.setDurationMinutes(90);
    when(appointmentRepository.countOverlapping(any(), any(), any(), any(), any(), any()))
        .thenReturn(0L);

    var req = new AppointmentCreateRequest(null, PROFESSIONAL_ID, SERVICE_ID, START_AT);
    var res = service.create(TENANT_ID, req);

    Instant start = Instant.parse(START_AT);
    Instant expectedEnd = start.plusSeconds(90L * 60);
    assertThat(Instant.parse(res.endAt())).isEqualTo(expectedEnd);
  }

  @Test
  void updateStatus_toConfirmed_succeeds() {
    Appointment appointment = buildAppointment(AppointmentStatus.PENDING);
    when(appointmentRepository.findByIdAndTenant_Id(1L, TENANT_ID))
        .thenReturn(Optional.of(appointment));

    var req = new AppointmentStatusUpdateRequest("CONFIRMED", null);
    var res = service.updateStatus(TENANT_ID, 1L, req);

    assertThat(res.status()).isEqualTo("CONFIRMED");
  }

  @Test
  void updateStatus_toCancelled_withReason_storesReason() {
    Appointment appointment = buildAppointment(AppointmentStatus.PENDING);
    when(appointmentRepository.findByIdAndTenant_Id(1L, TENANT_ID))
        .thenReturn(Optional.of(appointment));

    var req = new AppointmentStatusUpdateRequest("CANCELLED", "Client requested");
    var res = service.updateStatus(TENANT_ID, 1L, req);

    assertThat(res.status()).isEqualTo("CANCELLED");
    assertThat(res.cancelReason()).isEqualTo("Client requested");
  }

  @Test
  void updateStatus_toInvalidStatus_throwsBadRequest() {
    Appointment appointment = buildAppointment(AppointmentStatus.PENDING);
    when(appointmentRepository.findByIdAndTenant_Id(1L, TENANT_ID))
        .thenReturn(Optional.of(appointment));

    var req = new AppointmentStatusUpdateRequest("INVALID_STATUS", null);
    assertThatThrownBy(() -> service.updateStatus(TENANT_ID, 1L, req))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            e -> assertThat(((ResponseStatusException) e).getStatusCode().value()).isEqualTo(400));
  }

  @Test
  void updateStatus_notFound_throwsNotFound() {
    when(appointmentRepository.findByIdAndTenant_Id(99L, TENANT_ID)).thenReturn(Optional.empty());

    var req = new AppointmentStatusUpdateRequest("CONFIRMED", null);
    assertThatThrownBy(() -> service.updateStatus(TENANT_ID, 99L, req))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            e -> assertThat(((ResponseStatusException) e).getStatusCode().value()).isEqualTo(404));
  }

  @Test
  void update_inPendingStatus_succeeds() {
    Appointment appointment = buildAppointment(AppointmentStatus.PENDING);
    when(appointmentRepository.findByIdAndTenant_Id(1L, TENANT_ID))
        .thenReturn(Optional.of(appointment));
    when(appointmentRepository.countOverlapping(
            eq(TENANT_ID),
            eq(PROFESSIONAL_ID),
            any(),
            any(),
            eq(1L),
            eq(AppointmentStatus.CANCELLED)))
        .thenReturn(0L);

    var req = new AppointmentUpdateRequest(CLIENT_ID, PROFESSIONAL_ID, SERVICE_ID, START_AT);
    var res = service.update(TENANT_ID, 1L, req);

    assertThat(res.status()).isEqualTo("PENDING");
    assertThat(res.professionalName()).isEqualTo("Ana Gomez");
  }

  @Test
  void update_inCompletedStatus_throwsConflict() {
    Appointment appointment = buildAppointment(AppointmentStatus.COMPLETED);
    when(appointmentRepository.findByIdAndTenant_Id(1L, TENANT_ID))
        .thenReturn(Optional.of(appointment));

    var req = new AppointmentUpdateRequest(null, PROFESSIONAL_ID, SERVICE_ID, START_AT);
    assertThatThrownBy(() -> service.update(TENANT_ID, 1L, req))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            e -> {
              ResponseStatusException ex = (ResponseStatusException) e;
              assertThat(ex.getStatusCode().value()).isEqualTo(409);
              assertThat(ex.getReason()).isEqualTo("APPOINTMENT_NOT_EDITABLE");
            });
  }

  @Test
  void update_inCancelledStatus_throwsConflict() {
    Appointment appointment = buildAppointment(AppointmentStatus.CANCELLED);
    when(appointmentRepository.findByIdAndTenant_Id(1L, TENANT_ID))
        .thenReturn(Optional.of(appointment));

    var req = new AppointmentUpdateRequest(null, PROFESSIONAL_ID, SERVICE_ID, START_AT);
    assertThatThrownBy(() -> service.update(TENANT_ID, 1L, req))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            e -> assertThat(((ResponseStatusException) e).getStatusCode().value()).isEqualTo(409));
  }

  @Test
  void update_withOverlap_throwsConflict() {
    Appointment appointment = buildAppointment(AppointmentStatus.CONFIRMED);
    when(appointmentRepository.findByIdAndTenant_Id(1L, TENANT_ID))
        .thenReturn(Optional.of(appointment));
    when(appointmentRepository.countOverlapping(
            eq(TENANT_ID),
            eq(PROFESSIONAL_ID),
            any(),
            any(),
            eq(1L),
            eq(AppointmentStatus.CANCELLED)))
        .thenReturn(2L);

    var req = new AppointmentUpdateRequest(null, PROFESSIONAL_ID, SERVICE_ID, START_AT);
    assertThatThrownBy(() -> service.update(TENANT_ID, 1L, req))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            e -> assertThat(((ResponseStatusException) e).getStatusCode().value()).isEqualTo(409));
  }

  @Test
  void list_delegatesToRepository() {
    Instant from = Instant.parse("2026-04-07T00:00:00Z");
    Instant to = Instant.parse("2026-04-14T00:00:00Z");
    Appointment appointment = buildAppointment(AppointmentStatus.PENDING);
    when(appointmentRepository.findInRangeFiltered(TENANT_ID, from, to, null))
        .thenReturn(List.of(appointment));

    var result = service.list(TENANT_ID, from, to, null);

    assertThat(result).hasSize(1);
    assertThat(result.get(0).status()).isEqualTo("PENDING");
    verify(appointmentRepository).findInRangeFiltered(TENANT_ID, from, to, null);
  }

  @Test
  void get_returnsAppointment() {
    Appointment appointment = buildAppointment(AppointmentStatus.CONFIRMED);
    when(appointmentRepository.findByIdAndTenant_Id(1L, TENANT_ID))
        .thenReturn(Optional.of(appointment));

    var res = service.get(TENANT_ID, 1L);

    assertThat(res.id()).isEqualTo(1L);
    assertThat(res.status()).isEqualTo("CONFIRMED");
    assertThat(res.professionalName()).isEqualTo("Ana Gomez");
  }

  @Test
  void get_notFound_throwsNotFound() {
    when(appointmentRepository.findByIdAndTenant_Id(99L, TENANT_ID)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.get(TENANT_ID, 99L))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(
            e -> {
              ResponseStatusException ex = (ResponseStatusException) e;
              assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
            });
  }

  private Appointment buildAppointment(AppointmentStatus status) {
    Appointment a = new Appointment();
    a.setId(1L);
    a.setTenant(tenant);
    a.setProfessional(professional);
    a.setSalonService(salonService);
    a.setClient(client);
    a.setStartAt(Instant.parse(START_AT));
    a.setEndAt(Instant.parse(START_AT).plusSeconds(3600));
    a.setStatus(status);
    return a;
  }
}
