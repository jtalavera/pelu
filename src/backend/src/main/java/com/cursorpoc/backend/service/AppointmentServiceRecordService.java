package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Appointment;
import com.cursorpoc.backend.domain.ServiceRecord;
import com.cursorpoc.backend.domain.enums.AppointmentStatus;
import com.cursorpoc.backend.domain.enums.ServiceRecordStatus;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.repository.ServiceRecordRepository;
import com.cursorpoc.backend.web.dto.ServiceRecordLineRequest;
import com.cursorpoc.backend.web.dto.ServiceRecordListItemResponse;
import com.cursorpoc.backend.web.dto.ServiceRecordRequest;
import com.cursorpoc.backend.web.dto.ServiceRecordResponse;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * The turno ↔ ficha de servicio circuit: a turno has at most one ficha and a ficha belongs to at
 * most one turno. The ficha is created from the turno (same client, service and professional) or an
 * open ficha of the same client from today is assigned to it; either way a Pendiente / Confirmado
 * turno moves to En curso. Charging the ficha completes the turno (see {@code InvoiceService}).
 */
@Service
public class AppointmentServiceRecordService {

  private static final Set<AppointmentStatus> LINKABLE =
      Set.of(AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED, AppointmentStatus.IN_PROGRESS);

  private final AppointmentRepository appointmentRepository;
  private final ServiceRecordRepository serviceRecordRepository;
  private final ServiceRecordService serviceRecordService;
  private final FemmeTimeProperties timeProperties;

  public AppointmentServiceRecordService(
      AppointmentRepository appointmentRepository,
      ServiceRecordRepository serviceRecordRepository,
      ServiceRecordService serviceRecordService,
      FemmeTimeProperties timeProperties) {
    this.appointmentRepository = appointmentRepository;
    this.serviceRecordRepository = serviceRecordRepository;
    this.serviceRecordService = serviceRecordService;
    this.timeProperties = timeProperties;
  }

  /** Creates the turno's ficha with its client, service and professional. */
  @Transactional
  public ServiceRecordResponse createFromAppointment(long tenantId, long appointmentId) {
    Appointment appointment = requireLinkableAppointment(tenantId, appointmentId);
    if (appointment.getClient() == null) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "APPOINTMENT_WITHOUT_CLIENT");
    }
    ServiceRecordResponse created =
        serviceRecordService.createServiceRecord(
            tenantId,
            new ServiceRecordRequest(
                appointment.getClient().getId(),
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
        || !appointment.getClient().getId().equals(record.getClient().getId())) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "SERVICE_RECORD_CLIENT_MISMATCH");
    }
    if (record.getStatus() != ServiceRecordStatus.OPEN) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "SERVICE_RECORD_NOT_OPEN");
    }
    if (record.getAppointment() != null) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "SERVICE_RECORD_ALREADY_LINKED");
    }
    return link(tenantId, appointment, record);
  }

  /** Open fichas of today, of the turno's client, that no turno has taken yet. */
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
    record.setAppointment(appointment);
    serviceRecordRepository.saveAndFlush(record);
    if (appointment.getStatus() == AppointmentStatus.PENDING
        || appointment.getStatus() == AppointmentStatus.CONFIRMED) {
      appointment.setStatus(AppointmentStatus.IN_PROGRESS);
      appointmentRepository.save(appointment);
    }
    return serviceRecordService.getServiceRecord(tenantId, record.getId());
  }

  private Appointment requireLinkableAppointment(long tenantId, long appointmentId) {
    Appointment appointment = requireAppointment(tenantId, appointmentId);
    if (!LINKABLE.contains(appointment.getStatus())) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "APPOINTMENT_NOT_ACTIVE");
    }
    if (serviceRecordRepository
        .findByTenant_IdAndAppointment_Id(tenantId, appointmentId)
        .isPresent()) {
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
