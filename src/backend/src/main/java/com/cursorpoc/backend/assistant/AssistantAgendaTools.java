package com.cursorpoc.backend.assistant;

import com.cursorpoc.backend.assistant.AssistantDraftPayloads.AppointmentDraftPayload;
import com.cursorpoc.backend.assistant.AssistantModelClient.ToolSpec;
import com.cursorpoc.backend.assistant.ToolOutcome.CardEvent;
import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.service.AvailabilityService;
import com.cursorpoc.backend.service.AvailabilityService.DayPart;
import com.cursorpoc.backend.service.AvailabilityService.ProfessionalSlots;
import com.cursorpoc.backend.service.ServiceCatalogService;
import com.cursorpoc.backend.web.dto.ServiceResponse;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * The agenda tools: free times ({@code consultar_disponibilidad}, read-only, answered as tappable
 * time chips) and a booking DRAFT ({@code proponer_turno}). Like invoicing, nothing is booked here:
 * the appointment exists only after the person confirms the card. One service per appointment. A
 * professional can only book for herself.
 */
@Component
public class AssistantAgendaTools {

  static final String CONSULTAR_DISPONIBILIDAD = "consultar_disponibilidad";
  static final String PROPONER_TURNO = "proponer_turno";

  static final String EVENT_OPTIONS = "card.options";
  static final int MAX_CHIPS = 8;

  private static final Pattern HH_MM = Pattern.compile("^(\\d{1,2}):(\\d{2})$");

  private final AssistantAppointmentDrafts appointmentDrafts;
  private final AvailabilityService availability;
  private final ServiceCatalogService catalogService;
  private final AssistantDraftService draftService;
  private final FemmeTimeProperties timeProperties;
  private final ObjectMapper objectMapper;

  public AssistantAgendaTools(
      AssistantAppointmentDrafts appointmentDrafts,
      AvailabilityService availability,
      ServiceCatalogService catalogService,
      AssistantDraftService draftService,
      FemmeTimeProperties timeProperties,
      ObjectMapper objectMapper) {
    this.appointmentDrafts = appointmentDrafts;
    this.availability = availability;
    this.catalogService = catalogService;
    this.draftService = draftService;
    this.timeProperties = timeProperties;
    this.objectMapper = objectMapper;
  }

  boolean handles(String name) {
    return CONSULTAR_DISPONIBILIDAD.equals(name) || PROPONER_TURNO.equals(name);
  }

  List<ToolSpec> specsFor(AssistantContext ctx) {
    return List.of(
        new ToolSpec(
            CONSULTAR_DISPONIBILIDAD,
            "Horarios libres de un día para UN servicio (el sistema calcula la duración). Muestra"
                + " botones de horario a la persona. Opcional: un profesional y la franja.",
            AssistantTools.schema(
                "{\"date\":{\"type\":\"string\",\"description\":\"yyyy-MM-dd, 'hoy' o 'mañana'\"},"
                    + "\"serviceId\":{\"type\":\"integer\"},"
                    + "\"professionalId\":{\"type\":\"integer\"},"
                    + "\"dayPart\":{\"type\":\"string\",\"enum\":[\"ANY\",\"MORNING\",\"AFTERNOON\"]}}",
                "[\"date\",\"serviceId\"]")),
        new ToolSpec(
            PROPONER_TURNO,
            "Prepara un BORRADOR de turno para un cliente; no agenda nada: la persona lo revisa y lo"
                + " confirma con un botón. Un solo servicio por turno. Sin professionalId elige uno"
                + " libre."
                + (ctx.isProfessional() ? " Solo podés agendar para vos misma." : ""),
            AssistantTools.schema(
                "{\"clientId\":{\"type\":\"integer\"},"
                    + "\"serviceId\":{\"type\":\"integer\"},"
                    + "\"professionalId\":{\"type\":\"integer\"},"
                    + "\"date\":{\"type\":\"string\",\"description\":\"yyyy-MM-dd, 'hoy' o"
                    + " 'mañana'\"},"
                    + "\"time\":{\"type\":\"string\",\"description\":\"HH:mm\"}}",
                "[\"clientId\",\"serviceId\",\"date\",\"time\"]")));
  }

  ToolOutcome run(AssistantContext ctx, String name, JsonNode args) {
    return switch (name) {
      case CONSULTAR_DISPONIBILIDAD -> consultar(ctx, args);
      case PROPONER_TURNO -> proponer(ctx, args);
      default -> throw new AssistantTools.ToolException("UNKNOWN_TOOL");
    };
  }

  // ---------------------------------------------------------------------------------------------

  private ToolOutcome consultar(AssistantContext ctx, JsonNode args) {
    ZoneId zone = timeProperties.zoneId();
    LocalDate date = AssistantTools.resolveDate(text(args, "date"), zone);
    Long serviceId = longArg(args, "serviceId");
    if (serviceId == null) {
      throw new AssistantTools.ToolException("SERVICE_REQUIRED");
    }
    ServiceResponse service = activeService(ctx.tenantId(), serviceId);
    Long professionalId = longArg(args, "professionalId");
    DayPart part = DayPart.parse(text(args, "dayPart"));
    Instant now = Instant.now();

    List<ProfessionalSlots> byProfessional =
        availability.forDay(
            ctx.tenantId(), date, service.durationMinutes(), professionalId, part, now, MAX_CHIPS);
    boolean any = byProfessional.stream().anyMatch(p -> !p.slots().isEmpty());

    List<Map<String, Object>> professionals = new ArrayList<>();
    for (ProfessionalSlots ps : byProfessional) {
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("id", ps.professionalId());
      row.put("name", ps.professionalName());
      row.put("hasSchedule", ps.hasSchedule());
      row.put("slots", ps.slots().stream().map(s -> s.time().toString()).toList());
      professionals.add(row);
    }
    Map<String, Object> data = new LinkedHashMap<>();
    data.put("date", date.toString());
    data.put("service", service.name());
    data.put("durationMinutes", service.durationMinutes());
    data.put("professionals", professionals);
    if (!any) {
      availability
          .nextDayWithSlots(
              ctx.tenantId(), date, service.durationMinutes(), professionalId, part, now, 14)
          .ifPresent(d -> data.put("suggestedDate", d.toString()));
    }

    List<CardEvent> cards = new ArrayList<>();
    if (any) {
      cards.add(new CardEvent(EVENT_OPTIONS, slotChips(byProfessional, date, serviceId)));
      data.put(
          "instruction",
          "Los horarios ya aparecen como botones: no los repitas todos. Preguntá cuál prefiere y"
              + " para qué cliente.");
    }
    return new ToolOutcome(
        objectMapper.writeValueAsString(Map.of("data", data)), List.copyOf(cards));
  }

  private ToolOutcome proponer(AssistantContext ctx, JsonNode args) {
    if (ctx.conversationId() == null) {
      throw new AssistantTools.ToolException("NO_CONVERSATION");
    }
    ZoneId zone = timeProperties.zoneId();
    Long professionalId = longArg(args, "professionalId");
    if (ctx.isProfessional()) {
      if (ctx.professionalId() == null) {
        throw new AssistantTools.ToolException("FORBIDDEN");
      }
      if (professionalId != null && !professionalId.equals(ctx.professionalId())) {
        throw new AssistantTools.ToolException("APPOINTMENT_NOT_OWNED_BY_PROFESSIONAL");
      }
      professionalId = ctx.professionalId();
    }
    LocalDate date = AssistantTools.resolveDate(text(args, "date"), zone);
    LocalTime time = parseTime(text(args, "time"));
    Instant now = Instant.now();
    AssistantAppointmentDrafts.Request request =
        new AssistantAppointmentDrafts.Request(
            longArg(args, "clientId"), longArg(args, "serviceId"), professionalId, date, time);

    AppointmentDraftPayload payload;
    try {
      payload = appointmentDrafts.build(ctx.tenantId(), request, now);
    } catch (AssistantTools.ToolException e) {
      if ("SLOT_TAKEN".equals(e.getMessage())) {
        // The error tells the model; the alternatives also become tappable chips for the person.
        return new ToolOutcome(
            objectMapper.writeValueAsString(errorBody(e)),
            List.of(new CardEvent(EVENT_OPTIONS, alternativeChips(e.extra(), request))));
      }
      throw e;
    }
    AssistantDraftService.Created created = draftService.createAppointmentDraft(ctx, payload);

    List<CardEvent> cards = new ArrayList<>();
    for (String old : created.supersededIds()) {
      cards.add(
          new CardEvent(
              AssistantProposalTools.EVENT_DRAFT_UPDATED,
              Map.of("id", old, "status", "SUPERSEDED")));
    }
    cards.add(new CardEvent(AssistantProposalTools.EVENT_DRAFT, created.draft()));

    Map<String, Object> data = new LinkedHashMap<>();
    data.put("draftId", created.draft().id());
    data.put("status", "DRAFT");
    data.put("client", payload.clientName());
    data.put("service", payload.serviceName());
    data.put("professional", payload.professionalName());
    data.put("date", payload.date());
    data.put("time", payload.time());
    data.put("durationMinutes", payload.durationMinutes());
    data.put("outsideWorkingHours", payload.outsideWorkingHours());
    data.put(
        "instruction",
        "El borrador YA aparece en una tarjeta con el botón «Confirmar y agendar»: decile a la persona"
            + " que lo revise y lo confirme con ese botón. Todavía NO se agendó nada: nunca digas"
            + " que el turno ya está agendado. Si outsideWorkingHours es true, avisale que queda"
            + " fuera del horario de trabajo del profesional.");
    return new ToolOutcome(
        objectMapper.writeValueAsString(Map.of("data", data)), List.copyOf(cards));
  }

  // ---------------------------------------------------------------------------------------------

  /**
   * Chips for the free times. The value is what is sent as the person's message when tapped: tool
   * results are not replayed between turns, so it carries the ids the model needs.
   */
  private Map<String, Object> slotChips(
      List<ProfessionalSlots> byProfessional, LocalDate date, long serviceId) {
    long withSlots = byProfessional.stream().filter(p -> !p.slots().isEmpty()).count();
    List<Map<String, String>> options = new ArrayList<>();
    for (ProfessionalSlots ps : byProfessional) {
      for (AvailabilityService.Slot slot : ps.slots()) {
        if (options.size() >= MAX_CHIPS) {
          break;
        }
        String time = slot.time().format(AssistantAppointmentDrafts.HH_MM);
        options.add(
            chip(
                withSlots > 1 ? time + " · " + ps.professionalName() : time,
                "Quiero el turno del "
                    + date
                    + " a las "
                    + time
                    + " con "
                    + ps.professionalName()
                    + " (profesional "
                    + ps.professionalId()
                    + ", servicio "
                    + serviceId
                    + ")"));
      }
    }
    return Map.of("kind", "SLOT", "options", options);
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> alternativeChips(
      Map<String, Object> extra, AssistantAppointmentDrafts.Request request) {
    List<Map<String, String>> options = new ArrayList<>();
    for (Map<String, Object> alt : (List<Map<String, Object>>) extra.get("alternatives")) {
      options.add(
          chip(
              alt.get("time") + " · " + alt.get("professionalName"),
              "Quiero el turno del "
                  + request.date()
                  + " a las "
                  + alt.get("time")
                  + " con "
                  + alt.get("professionalName")
                  + " (profesional "
                  + alt.get("professionalId")
                  + ", servicio "
                  + request.serviceId()
                  + ")"));
    }
    return Map.of("kind", "SLOT", "options", options);
  }

  private static Map<String, String> chip(String label, String value) {
    Map<String, String> o = new LinkedHashMap<>();
    o.put("label", label);
    o.put("value", value);
    return o;
  }

  private static Map<String, Object> errorBody(AssistantTools.ToolException e) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("error", e.getMessage());
    body.putAll(e.extra());
    return body;
  }

  private static LocalTime parseTime(String raw) {
    Matcher m = raw == null ? null : HH_MM.matcher(raw.trim());
    if (m == null || !m.matches()) {
      throw new AssistantTools.ToolException("INVALID_TIME");
    }
    int h = Integer.parseInt(m.group(1));
    int min = Integer.parseInt(m.group(2));
    if (h > 23 || min > 59) {
      throw new AssistantTools.ToolException("INVALID_TIME");
    }
    return LocalTime.of(h, min);
  }

  private ServiceResponse activeService(long tenantId, long serviceId) {
    return catalogService.listServices(tenantId, Optional.empty(), null, "SERVICE").stream()
        .filter(s -> s.id() == serviceId && s.active())
        .findFirst()
        .orElseThrow(() -> new AssistantTools.ToolException("SERVICE_NOT_FOUND"));
  }

  private static Long longArg(JsonNode args, String field) {
    JsonNode n = args.get(field);
    if (n == null || n.isNull()) {
      return null;
    }
    if (!n.canConvertToLong()) {
      throw new AssistantTools.ToolException("INVALID_ARGUMENTS");
    }
    return n.asLong();
  }

  private static String text(JsonNode args, String field) {
    JsonNode n = args.get(field);
    return n == null || n.isNull() || n.asString().isBlank() ? null : n.asString().trim();
  }
}
