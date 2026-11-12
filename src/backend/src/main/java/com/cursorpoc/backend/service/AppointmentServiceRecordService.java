package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Appointment;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.ServiceRecord;
import com.cursorpoc.backend.domain.ServiceRecordLine;
import com.cursorpoc.backend.domain.enums.AppointmentStatus;
import com.cursorpoc.backend.domain.enums.ServiceRecordStatus;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.repository.ServiceRecordRepository;
import com.cursorpoc.backend.web.dto.ServiceRecordLineRequest;
import com.cursorpoc.backend.web.dto.ServiceRecordListItemResponse;
import com.cursorpoc.backend.web.dto.ServiceRecordRequest;
import com.cursorpoc.backend.web.dto.ServiceRecordResponse;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import org.hibernate.Hibernate;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * The turno ↔ ficha de servicio circuit: a turno has at most one ficha, while a ficha may belong to
 * several turnos. The ficha is created from the turno (same client, service and professional) or an
 * open ficha of the same client from today is assigned to it; either way a Pendiente / Confirmado
 * turno moves to En curso. Charging the ficha completes all its turnos (see InvoiceService).
 */
@Service
public class AppointmentServiceRecordService {

  private static final Set<AppointmentStatus> LINKABLE =
      Set.of(AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED, AppointmentStatus.IN_PROGRESS);

  private final AppointmentRepository appointmentRepository;
  private final ServiceRecordRepository serviceRecordRepository;
  private final ServiceRecordService serviceRecordService;
  private final FemmeTimeProperties timeProperties;
  private final ClientService clientService;

  public AppointmentServiceRecordService(
      AppointmentRepository appointmentRepository,
      ServiceRecordRepository serviceRecordRepository,
      ServiceRecordService serviceRecordService,
      FemmeTimeProperties timeProperties,
      ClientService clientService) {
    this.appointmentRepository = appointmentRepository;
    this.serviceRecordRepository = serviceRecordRepository;
    this.serviceRecordService = serviceRecordService;
    this.timeProperties = timeProperties;
    this.clientService = clientService;
  }

  /** Creates the turno's ficha with its client, service and professional. */
  @Transactional
  public ServiceRecordResponse createFromAppointment(long tenantId, long appointmentId) {
    Appointment appointment = requireLinkableAppointment(tenantId, appointmentId);
    // A turno of an occasional client (no registered client) takes the tenant's generic client.
    Long clientId =
        appointment.getClient() != null
            ? appointment.getClient().getId()
            : clientService.getOrCreateGenericClient(tenantId).getId();
    ServiceRecordResponse created =
        serviceRecordService.createServiceRecord(
            tenantId,
            new ServiceRecordRequest(
                clientId,
                List.of(
                    new ServiceRecordLineRequest(
                        appointment.getSalonService().getId(),
                        appointment.getProfessional().getId(),
                        1,
                        null)),
                List.of()));
    ServiceRecord record = requireRecord(tenantId, created.id());
    return link(tenantId, appointment, record);
  }

  /** Assigns an open, unlinked ficha of the turno's client to the turno. */
  @Transactional
  public ServiceRecordResponse assign(long tenantId, long appointmentId, long serviceRecordId) {
    Appointment appointment = requireLinkableAppointment(tenantId, appointmentId);
    ServiceRecord record = requireRecord(tenantId, serviceRecordId);
    if (appointment.getClient() == null
        || record.getClient().isGeneric()
        || !appointment.getClient().getId().equals(record.getClient().getId())) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "SERVICE_RECORD_CLIENT_MISMATCH");
    }
    if (record.getStatus() != ServiceRecordStatus.OPEN) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "SERVICE_RECORD_NOT_OPEN");
    }
    ensureTurnoService(record, appointment);
    return link(tenantId, appointment, record);
  }

  /**
   * The turno's service must be on the ficha it is assigned to: a line with that service takes the
   * turno's professional; without one, the service is added (quantity 1, catalog price, turno's
   * professional). Existing lines and quantities are left alone. When the ficha already serves
   * other turnos, a line is only reused if it has no professional or is already the turno's own, so
   * one turno never takes over the line of another.
   */
  private void ensureTurnoService(ServiceRecord record, Appointment appointment) {
    Hibernate.initialize(record.getLines());
    Hibernate.initialize(record.getTips());
    SalonService turnoService = appointment.getSalonService();
    boolean sharedWithOtherTurnos = !record.getAppointments().isEmpty();
    Long turnoProfessionalId = appointment.getProfessional().getId();
    ServiceRecordLine match =
        record.getLines().stream()
            .filter(l -> l.getSalonService().getId().equals(turnoService.getId()))
            .filter(
                l ->
                    !sharedWithOtherTurnos
                        || l.getProfessional() == null
                        || l.getProfessional().getId().equals(turnoProfessionalId))
            .findFirst()
            .orElse(null);
    if (match != null) {
      match.setProfessional(appointment.getProfessional());
    } else {
      ServiceRecordLine line = new ServiceRecordLine();
      line.setServiceRecord(record);
      line.setSalonService(turnoService);
      line.setProfessional(appointment.getProfessional());
      line.setDescription(turnoService.getName());
      line.setUnitPrice(
          (turnoService.getPriceMinor() != null ? turnoService.getPriceMinor() : BigDecimal.ZERO)
              .setScale(2, RoundingMode.HALF_UP));
      line.setQuantity(1);
      record.getLines().add(line);
    }
    record.setTotalAmount(
        record.getLines().stream()
            .map(l -> l.getUnitPrice().multiply(BigDecimal.valueOf(l.getQuantity())))
            .reduce(BigDecimal.ZERO, BigDecimal::add)
            .setScale(2, RoundingMode.HALF_UP));
    // A tip stays only while its professional is still on some line.
    Set<Long> onLines =
        record.getLines().stream()
            .filter(l -> l.getProfessional() != null)
            .map(l -> l.getProfessional().getId())
            .collect(Collectors.toSet());
    record.getTips().removeIf(t -> !onLines.contains(t.getProfessional().getId()));
  }

  /** Open fichas of today of the turno's client (a ficha may serve several turnos). */
  @Transactional(readOnly = true)
  public List<ServiceRecordListItemResponse> candidates(long tenantId, long appointmentId) {
    Appointment appointment = requireAppointment(tenantId, appointmentId);
    if (appointment.getClient() == null) {
      return List.of();
    }
    ZoneId zone = timeProperties.zoneId();
    LocalDate today = LocalDate.now(zone);
    Instant from = today.atStartOfDay(zone).toInstant();
    Instant to = today.plusDays(1).atStartOfDay(zone).toInstant().minusMillis(1);
    return serviceRecordRepository
        .findAssignable(
            tenantId, appointment.getClient().getId(), ServiceRecordStatus.OPEN, from, to)
        .stream()
        .map(r -> serviceRecordService.toListItem(r))
        .toList();
  }

  private ServiceRecordResponse link(long tenantId, Appointment appointment, ServiceRecord record) {
    appointment.setServiceRecord(record);
    if (!record.getAppointments().contains(appointment)) {
      record.getAppointments().add(appointment);
    }
    if (appointment.getStatus() == AppointmentStatus.PENDING
        || appointment.getStatus() == AppointmentStatus.CONFIRMED) {
      appointment.setStatus(AppointmentStatus.IN_PROGRESS);
    }
    appointmentRepository.saveAndFlush(appointment);
    serviceRecordRepository.saveAndFlush(record);
    return serviceRecordService.getServiceRecord(tenantId, record.getId());
  }

  private Appointment requireLinkableAppointment(long tenantId, long appointmentId) {
    Appointment appointment = requireAppointment(tenantId, appointmentId);
    if (!LINKABLE.contains(appointment.getStatus())) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "APPOINTMENT_NOT_ACTIVE");
    }
    if (appointment.getServiceRecord() != null) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "APPOINTMENT_ALREADY_HAS_SERVICE_RECORD");
    }
    return appointment;
  }

  private Appointment requireAppointment(long tenantId, long appointmentId) {
    return appointmentRepository
        .findByIdAndTenant_Id(appointmentId, tenantId)
        .orElseThrow(
            () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "APPOINTMENT_NOT_FOUND"));
  }

  private ServiceRecord requireRecord(long tenantId, long id) {
    return serviceRecordRepository
        .findByIdAndTenant_Id(id, tenantId)
        .orElseThrow(
            () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "SERVICE_RECORD_NOT_FOUND"));
  }
}
