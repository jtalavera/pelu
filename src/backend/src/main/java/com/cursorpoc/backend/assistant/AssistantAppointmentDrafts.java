package com.cursorpoc.backend.assistant;

import com.cursorpoc.backend.assistant.AssistantDraftPayloads.AppointmentDraftPayload;
import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.service.AvailabilityService;
import com.cursorpoc.backend.service.AvailabilityService.DayPart;
import com.cursorpoc.backend.service.AvailabilityService.ProfessionalSlots;
import com.cursorpoc.backend.service.ClientService;
import com.cursorpoc.backend.service.ProfessionalDirectoryService;
import com.cursorpoc.backend.service.ServiceCatalogService;
import com.cursorpoc.backend.web.dto.AppointmentCreateRequest;
import com.cursorpoc.backend.web.dto.ClientResponse;
import com.cursorpoc.backend.web.dto.ProfessionalOptionResponse;
import com.cursorpoc.backend.web.dto.ServiceResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Component;

/**
 * Everything about APPOINTMENT drafts that is not persistence: validating the client, the service
 * (one per appointment) and the professional, checking the slot against the agenda with the SAME
 * overlap rule as booking, offering alternatives when it is taken, and the request that creates the
 * appointment on confirmation. Times are the backend's: «mañana a las 10» is resolved in the
 * salon's zone, never by the model.
 */
@Component
public class AssistantAppointmentDrafts {

  static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");
  static final int ALTERNATIVES = 5;

  private final ClientService clientService;
  private final ServiceCatalogService catalogService;
  private final ProfessionalDirectoryService professionalService;
  private final AvailabilityService availability;
  private final FemmeTimeProperties timeProperties;

  public AssistantAppointmentDrafts(
      ClientService clientService,
      ServiceCatalogService catalogService,
      ProfessionalDirectoryService professionalService,
      AvailabilityService availability,
      FemmeTimeProperties timeProperties) {
    this.clientService = clientService;
    this.catalogService = catalogService;
    this.professionalService = professionalService;
    this.availability = availability;
    this.timeProperties = timeProperties;
  }

  /** {@code professionalId} null = «whoever is free». */
  public record Request(
      Long clientId, Long serviceId, Long professionalId, LocalDate date, LocalTime time) {}

  public AppointmentDraftPayload build(long tenantId, Request req, Instant now) {
    if (req.clientId() == null) {
      throw new AssistantTools.ToolException("CLIENT_REQUIRED");
    }
    if (req.serviceId() == null) {
      throw new AssistantTools.ToolException("SERVICE_REQUIRED");
    }
    ClientResponse client = clientService.getById(tenantId, req.clientId());
    ServiceResponse service = activeService(tenantId, req.serviceId());
    ZoneId zone = timeProperties.zoneId();
    Instant start = req.date().atTime(req.time()).atZone(zone).toInstant();
    if (start.isBefore(now)) {
      throw new AssistantTools.ToolException("START_IN_PAST");
    }
    int duration = service.durationMinutes();

    ProfessionalOptionResponse professional;
    if (req.professionalId() != null) {
      professional = activeProfessional(tenantId, req.professionalId());
      if (!availability.isFree(tenantId, professional.id(), start, duration, null)) {
        throw slotTaken(tenantId, req.date(), duration, professional.id(), now);
      }
    } else {
      professional = firstFreeProfessional(tenantId, start, duration);
      if (professional == null) {
        throw slotTaken(tenantId, req.date(), duration, null, now);
      }
    }
    return payload(client, service, professional, start, duration);
  }

  /**
   * Moves a draft to another slot (the person tapped an alternative); same checks as a proposal.
   */
  public AppointmentDraftPayload reschedule(
      long tenantId,
      AppointmentDraftPayload old,
      Instant newStart,
      Long newProfessionalId,
      Instant now) {
    ProfessionalOptionResponse professional =
        activeProfessional(
            tenantId, newProfessionalId != null ? newProfessionalId : old.professionalId());
    if (newStart.isBefore(now)) {
      throw new AssistantTools.ToolException("START_IN_PAST");
    }
    LocalDate date = newStart.atZone(timeProperties.zoneId()).toLocalDate();
    if (!availability.isFree(tenantId, professional.id(), newStart, old.durationMinutes(), null)) {
      throw slotTaken(tenantId, date, old.durationMinutes(), professional.id(), now);
    }
    ServiceResponse service = activeService(tenantId, old.serviceId());
    ClientResponse client = clientService.getById(tenantId, old.clientId());
    return payload(client, service, professional, newStart, old.durationMinutes());
  }

  /**
   * The request the regular booking road receives (state PENDING, reminder and metrics included).
   */
  public AppointmentCreateRequest toRequest(AppointmentDraftPayload p) {
    return new AppointmentCreateRequest(
        p.clientId(), p.professionalId(), p.serviceId(), p.startAt(), p.durationMinutes());
  }

  /**
   * Re-checks at confirmation: still bookable? Throws {@code SLOT_TAKEN} (with alternatives) if
   * not.
   */
  public void revalidate(long tenantId, AppointmentDraftPayload p, Instant now) {
    activeService(tenantId, p.serviceId());
    activeProfessional(tenantId, p.professionalId());
    Instant start = Instant.parse(p.startAt());
    LocalDate date = start.atZone(timeProperties.zoneId()).toLocalDate();
    if (!availability.isFree(tenantId, p.professionalId(), start, p.durationMinutes(), null)) {
      throw slotTaken(tenantId, date, p.durationMinutes(), p.professionalId(), now);
    }
  }

  public static String fingerprint(AppointmentDraftPayload p) {
    String text =
        p.professionalId() + "|" + p.serviceId() + "|" + p.startAt() + "|" + p.durationMinutes();
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  /** Other free times that day for the same service (and professional, when one was asked). */
  public List<Map<String, Object>> alternatives(
      long tenantId, LocalDate date, int duration, Long professionalId, Instant now) {
    List<Map<String, Object>> out = new ArrayList<>();
    for (ProfessionalSlots ps :
        availability.forDay(
            tenantId, date, duration, professionalId, DayPart.ANY, now, ALTERNATIVES)) {
      for (AvailabilityService.Slot slot : ps.slots()) {
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("time", slot.time().format(HH_MM));
        o.put("professionalId", ps.professionalId());
        o.put("professionalName", ps.professionalName());
        o.put("startAt", slot.startAt().toString());
        out.add(o);
      }
    }
    out.sort(Comparator.comparing(o -> (String) o.get("time")));
    return out.size() > ALTERNATIVES ? out.subList(0, ALTERNATIVES) : out;
  }

  // ---------------------------------------------------------------------------------------------

  private AssistantTools.ToolException slotTaken(
      long tenantId, LocalDate date, int duration, Long professionalId, Instant now) {
    return new AssistantTools.ToolException(
        "SLOT_TAKEN",
        Map.of(
            "date",
            date.toString(),
            "alternatives",
            alternatives(tenantId, date, duration, professionalId, now)));
  }

  private AppointmentDraftPayload payload(
      ClientResponse client,
      ServiceResponse service,
      ProfessionalOptionResponse professional,
      Instant start,
      int duration) {
    ZoneId zone = timeProperties.zoneId();
    Instant end = start.plus(Duration.ofMinutes(duration));
    return new AppointmentDraftPayload(
        client.id(),
        client.fullName(),
        service.id(),
        service.name(),
        professional.id(),
        professional.displayName(),
        start.toString(),
        start.atZone(zone).toLocalDate().toString(),
        start.atZone(zone).toLocalTime().format(HH_MM),
        end.atZone(zone).toLocalTime().format(HH_MM),
        duration,
        !availability.isWithinWorkingHours(professional.id(), start, end));
  }

  /** The first active professional (by name) free at that time, preferring one on duty. */
  private ProfessionalOptionResponse firstFreeProfessional(
      long tenantId, Instant start, int duration) {
    Instant end = start.plus(Duration.ofMinutes(duration));
    List<ProfessionalOptionResponse> free =
        professionalService.listOptions(tenantId).stream()
            .filter(ProfessionalOptionResponse::active)
            .filter(p -> availability.isFree(tenantId, p.id(), start, duration, null))
            .toList();
    Optional<ProfessionalOptionResponse> onDuty =
        free.stream()
            .filter(p -> availability.isWithinWorkingHours(p.id(), start, end))
            .findFirst();
    return onDuty.orElse(free.isEmpty() ? null : free.get(0));
  }

  private ServiceResponse activeService(long tenantId, Long serviceId) {
    return catalogService.listServices(tenantId, Optional.empty(), null, "SERVICE").stream()
        .filter(s -> s.id() == serviceId && s.active())
        .findFirst()
        .orElseThrow(() -> new AssistantTools.ToolException("SERVICE_NOT_FOUND"));
  }

  private ProfessionalOptionResponse activeProfessional(long tenantId, Long professionalId) {
    return professionalService.listOptions(tenantId).stream()
        .filter(p -> p.id() == professionalId && p.active())
        .findFirst()
        .orElseThrow(() -> new AssistantTools.ToolException("PROFESSIONAL_NOT_FOUND"));
  }
}
