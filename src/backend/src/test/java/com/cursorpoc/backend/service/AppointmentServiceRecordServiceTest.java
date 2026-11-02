package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Appointment;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.ServiceRecord;
import com.cursorpoc.backend.domain.enums.AppointmentStatus;
import com.cursorpoc.backend.domain.enums.ServiceRecordStatus;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.repository.ServiceRecordRepository;
import com.cursorpoc.backend.web.dto.ServiceRecordRequest;
import com.cursorpoc.backend.web.dto.ServiceRecordResponse;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;

@ExtendWith(MockitoExtension.class)
class AppointmentServiceRecordServiceTest {

  private static final long TENANT = 1L;

  @Mock private AppointmentRepository appointmentRepository;
  @Mock private ServiceRecordRepository serviceRecordRepository;
  @Mock private ServiceRecordService serviceRecordService;
  @Spy private FemmeTimeProperties timeProperties = new FemmeTimeProperties();

  private AppointmentServiceRecordService service;
  private Appointment appointment;
  private Client client;

  @BeforeEach
  void setUp() {
    service =
        new AppointmentServiceRecordService(
            appointmentRepository, serviceRecordRepository, serviceRecordService, timeProperties);
    client = new Client();
    client.setId(5L);
    Professional professional = new Professional();
    professional.setId(3L);
    SalonService salonService = new SalonService();
    salonService.setId(11L);
    appointment = new Appointment();
    appointment.setId(100L);
    appointment.setClient(client);
    appointment.setProfessional(professional);
    appointment.setSalonService(salonService);
    appointment.setStatus(AppointmentStatus.CONFIRMED);
    when(appointmentRepository.findByIdAndTenant_Id(100L, TENANT))
        .thenReturn(Optional.of(appointment));
    lenient()
        .when(serviceRecordRepository.findByTenant_IdAndAppointment_Id(TENANT, 100L))
        .thenReturn(Optional.empty());
  }

  private ServiceRecord openRecord(long id, Long clientId) {
    Client c = new Client();
    c.setId(clientId);
    ServiceRecord r = new ServiceRecord();
    r.setId(id);
    r.setClient(c);
    r.setStatus(ServiceRecordStatus.OPEN);
    return r;
  }

  @Test
  void createFromAppointment_copiesClientServiceAndProfessional_andStartsTheTurno() {
    ServiceRecord record = openRecord(9L, 5L);
    ServiceRecordResponse created = mock(ServiceRecordResponse.class);
    when(created.id()).thenReturn(9L);
    when(serviceRecordService.createServiceRecord(any(Long.class), any())).thenReturn(created);
    when(serviceRecordRepository.findByIdAndTenant_Id(9L, TENANT)).thenReturn(Optional.of(record));

    service.createFromAppointment(TENANT, 100L);

    ArgumentCaptor<ServiceRecordRequest> req = ArgumentCaptor.forClass(ServiceRecordRequest.class);
    org.mockito.Mockito.verify(serviceRecordService)
        .createServiceRecord(any(Long.class), req.capture());
    assertThat(req.getValue().clientId()).isEqualTo(5L);
    assertThat(req.getValue().lines()).hasSize(1);
    assertThat(req.getValue().lines().get(0).serviceId()).isEqualTo(11L);
    assertThat(req.getValue().lines().get(0).professionalId()).isEqualTo(3L);
    assertThat(record.getAppointment()).isSameAs(appointment);
    assertThat(appointment.getStatus()).isEqualTo(AppointmentStatus.IN_PROGRESS);
  }

  @Test
  void assign_linksAnOpenFichaOfTheSameClient_andStartsThePendingTurno() {
    appointment.setStatus(AppointmentStatus.PENDING);
    ServiceRecord record = openRecord(9L, 5L);
    when(serviceRecordRepository.findByIdAndTenant_Id(9L, TENANT)).thenReturn(Optional.of(record));

    service.assign(TENANT, 100L, 9L);

    assertThat(record.getAppointment()).isSameAs(appointment);
    assertThat(appointment.getStatus()).isEqualTo(AppointmentStatus.IN_PROGRESS);
  }

  @Test
  void assign_rejectsAnotherClientsFicha() {
    when(serviceRecordRepository.findByIdAndTenant_Id(9L, TENANT))
        .thenReturn(Optional.of(openRecord(9L, 77L)));
    assertThatThrownBy(() -> service.assign(TENANT, 100L, 9L))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SERVICE_RECORD_CLIENT_MISMATCH");
  }

  @Test
  void assign_rejectsAFichaAlreadyLinkedToAnotherTurno() {
    ServiceRecord record = openRecord(9L, 5L);
    record.setAppointment(new Appointment());
    when(serviceRecordRepository.findByIdAndTenant_Id(9L, TENANT)).thenReturn(Optional.of(record));
    assertThatThrownBy(() -> service.assign(TENANT, 100L, 9L))
        .hasMessageContaining("SERVICE_RECORD_ALREADY_LINKED");
  }

  @Test
  void assign_rejectsAChargedFicha() {
    ServiceRecord record = openRecord(9L, 5L);
    record.setStatus(ServiceRecordStatus.CLOSED);
    when(serviceRecordRepository.findByIdAndTenant_Id(9L, TENANT)).thenReturn(Optional.of(record));
    assertThatThrownBy(() -> service.assign(TENANT, 100L, 9L))
        .hasMessageContaining("SERVICE_RECORD_NOT_OPEN");
  }

  @Test
  void aTurnoWithAFichaCannotGetAnother() {
    when(serviceRecordRepository.findByTenant_IdAndAppointment_Id(TENANT, 100L))
        .thenReturn(Optional.of(openRecord(1L, 5L)));
    assertThatThrownBy(() -> service.createFromAppointment(TENANT, 100L))
        .hasMessageContaining("APPOINTMENT_ALREADY_HAS_SERVICE_RECORD");
  }

  @Test
  void aCancelledTurnoCannotGetAFicha() {
    appointment.setStatus(AppointmentStatus.CANCELLED);
    assertThatThrownBy(() -> service.createFromAppointment(TENANT, 100L))
        .hasMessageContaining("APPOINTMENT_NOT_ACTIVE");
  }

  @Test
  void aTurnoWithoutClientCannotCreateAFicha() {
    appointment.setClient(null);
    assertThatThrownBy(() -> service.createFromAppointment(TENANT, 100L))
        .hasMessageContaining("APPOINTMENT_WITHOUT_CLIENT");
  }
}
