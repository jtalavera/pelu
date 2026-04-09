package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.Appointment;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.Professional;
import com.cursorpoc.backend.domain.SalonService;
import com.cursorpoc.backend.domain.Tenant;
import com.cursorpoc.backend.domain.enums.AppointmentStatus;
import com.cursorpoc.backend.repository.AppointmentRepository;
import com.cursorpoc.backend.repository.ClientRepository;
import com.cursorpoc.backend.repository.ProfessionalRepository;
import com.cursorpoc.backend.repository.SalonServiceRepository;
import com.cursorpoc.backend.repository.TenantRepository;
import com.cursorpoc.backend.web.dto.AppointmentCreateRequest;
import com.cursorpoc.backend.web.dto.AppointmentResponse;
import com.cursorpoc.backend.web.dto.AppointmentStatusUpdateRequest;
import com.cursorpoc.backend.web.dto.AppointmentUpdateRequest;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AppointmentService {

  private static final Set<AppointmentStatus> EDITABLE_STATUSES =
      Set.of(AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED);

  private final AppointmentRepository appointmentRepository;
  private final TenantRepository tenantRepository;
  private final ProfessionalRepository professionalRepository;
  private final SalonServiceRepository salonServiceRepository;
  private final ClientRepository clientRepository;

  public AppointmentService(
      AppointmentRepository appointmentRepository,
      TenantRepository tenantRepository,
      ProfessionalRepository professionalRepository,
      SalonServiceRepository salonServiceRepository,
      ClientRepository clientRepository) {
    this.appointmentRepository = appointmentRepository;
    this.tenantRepository = tenantRepository;
    this.professionalRepository = professionalRepository;
    this.salonServiceRepository = salonServiceRepository;
    this.clientRepository = clientRepository;
  }

  @Transactional(readOnly = true)
  public List<AppointmentResponse> list(
      long tenantId, Instant from, Instant to, Long professionalId) {
    return appointmentRepository.findInRangeFiltered(tenantId, from, to, professionalId).stream()
        .map(this::toResponse)
        .toList();
  }

  @Transactional(readOnly = true)
  public AppointmentResponse get(long tenantId, long appointmentId) {
    Appointment appointment = loadAppointmentOrThrow(tenantId, appointmentId);
    return toResponse(appointment);
  }

  @Transactional
  public AppointmentResponse create(long tenantId, AppointmentCreateRequest request) {
    Tenant tenant = loadTenantOrThrow(tenantId);
    Professional professional = loadProfessionalOrThrow(tenantId, request.professionalId());
    SalonService service = loadServiceOrThrow(tenantId, request.serviceId());

    Instant startAt = parseInstant(request.startAt());
    Instant endAt = startAt.plusSeconds((long) service.getDurationMinutes() * 60);

    validateNoOverlap(tenantId, professional.getId(), startAt, endAt, null);

    Client client = null;
    if (request.clientId() != null) {
      client = loadClientOrThrow(tenantId, request.clientId());
    }

    Appointment appointment = new Appointment();
    appointment.setTenant(tenant);
    appointment.setProfessional(professional);
    appointment.setSalonService(service);
    appointment.setClient(client);
    appointment.setStartAt(startAt);
    appointment.setEndAt(endAt);
    appointment.setStatus(AppointmentStatus.PENDING);

    appointmentRepository.save(appointment);
    return toResponse(appointment);
  }

  @Transactional
  public AppointmentResponse updateStatus(
      long tenantId, long appointmentId, AppointmentStatusUpdateRequest request) {
    Appointment appointment = loadAppointmentOrThrow(tenantId, appointmentId);

    AppointmentStatus newStatus = parseStatus(request.status());

    if (newStatus == AppointmentStatus.CANCELLED) {
      appointment.setCancelReason(
          request.cancelReason() != null ? request.cancelReason().trim() : null);
    }

    appointment.setStatus(newStatus);
    appointmentRepository.save(appointment);
    return toResponse(appointment);
  }

  @Transactional
  public AppointmentResponse update(
      long tenantId, long appointmentId, AppointmentUpdateRequest request) {
    Appointment appointment = loadAppointmentOrThrow(tenantId, appointmentId);

    if (!EDITABLE_STATUSES.contains(appointment.getStatus())) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "APPOINTMENT_NOT_EDITABLE");
    }

    Professional professional = loadProfessionalOrThrow(tenantId, request.professionalId());
    SalonService service = loadServiceOrThrow(tenantId, request.serviceId());

    Instant startAt = parseInstant(request.startAt());
    Instant endAt = startAt.plusSeconds((long) service.getDurationMinutes() * 60);

    validateNoOverlap(tenantId, professional.getId(), startAt, endAt, appointmentId);

    Client client = null;
    if (request.clientId() != null) {
      client = loadClientOrThrow(tenantId, request.clientId());
    }

    appointment.setProfessional(professional);
    appointment.setSalonService(service);
    appointment.setClient(client);
    appointment.setStartAt(startAt);
    appointment.setEndAt(endAt);

    appointmentRepository.save(appointment);
    return toResponse(appointment);
  }

  private void validateNoOverlap(
      long tenantId, long professionalId, Instant startAt, Instant endAt, Long excludeId) {
    long overlaps =
        appointmentRepository.countOverlapping(
            tenantId, professionalId, startAt, endAt, excludeId, AppointmentStatus.CANCELLED);
    if (overlaps > 0) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "APPOINTMENT_OVERLAP");
    }
  }

  private Appointment loadAppointmentOrThrow(long tenantId, long id) {
    return appointmentRepository
        .findByIdAndTenant_Id(id, tenantId)
        .orElseThrow(
            () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "APPOINTMENT_NOT_FOUND"));
  }

  private Tenant loadTenantOrThrow(long tenantId) {
    return tenantRepository
        .findById(tenantId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TENANT_NOT_FOUND"));
  }

  private Professional loadProfessionalOrThrow(long tenantId, long professionalId) {
    return professionalRepository
        .findByIdAndTenant_Id(professionalId, tenantId)
        .orElseThrow(
            () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "PROFESSIONAL_NOT_FOUND"));
  }

  private SalonService loadServiceOrThrow(long tenantId, long serviceId) {
    return salonServiceRepository
        .findByIdAndTenant_Id(serviceId, tenantId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "SERVICE_NOT_FOUND"));
  }

  private Client loadClientOrThrow(long tenantId, long clientId) {
    return clientRepository
        .findByIdAndTenant_Id(clientId, tenantId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "CLIENT_NOT_FOUND"));
  }

  private static Instant parseInstant(String value) {
    try {
      return Instant.parse(value);
    } catch (Exception e) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_DATE_FORMAT");
    }
  }

  private static AppointmentStatus parseStatus(String value) {
    try {
      return AppointmentStatus.valueOf(value.toUpperCase());
    } catch (Exception e) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_APPOINTMENT_STATUS");
    }
  }

  private AppointmentResponse toResponse(Appointment a) {
    String clientName = null;
    Long clientId = null;
    if (a.getClient() != null) {
      clientId = a.getClient().getId();
      clientName = a.getClient().getFullName();
    }
    return new AppointmentResponse(
        a.getId(),
        clientId,
        clientName,
        a.getProfessional().getId(),
        a.getProfessional().getFullName(),
        a.getSalonService().getId(),
        a.getSalonService().getName(),
        a.getSalonService().getDurationMinutes(),
        a.getStartAt().toString(),
        a.getEndAt().toString(),
        a.getStatus().name(),
        a.getCancelReason());
  }
}
