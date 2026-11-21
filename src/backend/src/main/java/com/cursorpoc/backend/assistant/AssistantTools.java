package com.cursorpoc.backend.assistant;

import com.cursorpoc.backend.assistant.AssistantModelClient.ToolSpec;
import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.service.AppointmentService;
import com.cursorpoc.backend.service.ClientService;
import com.cursorpoc.backend.service.ProfessionalDirectoryService;
import com.cursorpoc.backend.service.ServiceCatalogService;
import com.cursorpoc.backend.web.dto.AppointmentResponse;
import com.cursorpoc.backend.web.dto.ClientResponse;
import java.text.Normalizer;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Read-only tools the model may request (phase 1 of the assistant). Every tool delegates to an
 * existing service with the tenant taken from {@link AssistantContext} — a tool has no tenant (or
 * role) parameter, and nothing here writes data.
 *
 * <p>Results are returned as {@code {"data": ...}} (or {@code {"error": "CODE"}}) and carry only
 * the fields the answer needs. The system prompt tells the model that this content is data, never
 * instructions.
 */
@Component
public class AssistantTools {

  private static final Logger log = LoggerFactory.getLogger(AssistantTools.class);

  static final String BUSCAR_CLIENTES = "buscar_clientes";
  static final String LISTAR_SERVICIOS = "listar_servicios";
  static final String LISTAR_PROFESIONALES = "listar_profesionales";
  static final String TURNOS_DEL_DIA = "turnos_del_dia";

  static final int MAX_CLIENTS = 10;
  static final int MAX_SERVICES = 40;
  static final int MAX_APPOINTMENTS = 50;

  private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");

  private final ClientService clientService;
  private final ServiceCatalogService serviceCatalogService;
  private final ProfessionalDirectoryService professionalDirectoryService;
  private final AppointmentService appointmentService;
  private final FemmeTimeProperties timeProperties;
  private final ObjectMapper objectMapper;
  private final AssistantProposalTools proposals;

  public AssistantTools(
      ClientService clientService,
      ServiceCatalogService serviceCatalogService,
      ProfessionalDirectoryService professionalDirectoryService,
      AppointmentService appointmentService,
      FemmeTimeProperties timeProperties,
      ObjectMapper objectMapper,
      AssistantProposalTools proposals) {
    this.clientService = clientService;
    this.serviceCatalogService = serviceCatalogService;
    this.professionalDirectoryService = professionalDirectoryService;
    this.appointmentService = appointmentService;
    this.timeProperties = timeProperties;
    this.objectMapper = objectMapper;
    this.proposals = proposals;
  }

  /** True for a tool this class implements — bounds the cardinality of the tool metric. */
  static boolean isKnown(String name) {
    return BUSCAR_CLIENTES.equals(name)
        || LISTAR_SERVICIOS.equals(name)
        || LISTAR_PROFESIONALES.equals(name)
        || TURNOS_DEL_DIA.equals(name)
        || AssistantProposalTools.PROPONER_FACTURA.equals(name)
        || AssistantProposalTools.DESCARTAR_BORRADOR.equals(name);
  }

  /** The tools offered to this user. All four are read-only and open to ADMIN and PROFESSIONAL. */
  public List<ToolSpec> specsFor(AssistantContext ctx) {
    List<ToolSpec> all = new java.util.ArrayList<>(readSpecs(ctx));
    all.addAll(proposals.specsFor(ctx));
    return all;
  }

  private List<ToolSpec> readSpecs(AssistantContext ctx) {
    return List.of(
        new ToolSpec(
            BUSCAR_CLIENTES,
            "Busca clientes del salón por nombre"
                + (ctx.isProfessional() ? "." : ", RUC o teléfono.")
                + " Devuelve como máximo "
                + MAX_CLIENTS
                + " resultados.",
            schema(
                "{\"query\":{\"type\":\"string\",\"description\":\"Texto a buscar\"}}",
                "[\"query\"]")),
        new ToolSpec(
            LISTAR_SERVICIOS,
            "Lista los servicios activos del catálogo: nombre y precio.",
            schema(
                "{\"query\":{\"type\":\"string\",\"description\":\"Filtro opcional por nombre o"
                    + " categoría\"}}",
                "[]")),
        new ToolSpec(
            LISTAR_PROFESIONALES, "Lista los profesionales activos del salón.", schema("{}", "[]")),
        new ToolSpec(
            TURNOS_DEL_DIA,
            "Lista los turnos de un día, opcionalmente de un cliente o de un profesional (usá los"
                + " ids devueltos por las otras herramientas).",
            schema(
                "{\"date\":{\"type\":\"string\",\"description\":\"Fecha ISO yyyy-MM-dd, o"
                    + " 'hoy' / 'mañana'\"},"
                    + "\"clientId\":{\"type\":\"integer\"},"
                    + "\"professionalId\":{\"type\":\"integer\"}}",
                "[\"date\"]")));
  }

  /** Runs one tool and returns only what the model reads (see {@link #run}). */
  public String execute(AssistantContext ctx, String name, String argumentsJson) {
    return run(ctx, name, argumentsJson).json();
  }

  /**
   * Runs one tool. Never throws: a failure becomes {@code {"error": "CODE"}} for the model. Besides
   * the JSON the model reads, the outcome carries the cards (drafts…) the person must see.
   */
  public ToolOutcome run(AssistantContext ctx, String name, String argumentsJson) {
    try {
      JsonNode args =
          argumentsJson == null || argumentsJson.isBlank()
              ? objectMapper.createObjectNode()
              : objectMapper.readTree(argumentsJson);
      if (proposals.handles(name)) {
        return proposals.run(ctx, name, args);
      }
      Object data =
          switch (name) {
            case BUSCAR_CLIENTES -> buscarClientes(ctx, args);
            case LISTAR_SERVICIOS -> listarServicios(ctx, args);
            case LISTAR_PROFESIONALES -> listarProfesionales(ctx);
            case TURNOS_DEL_DIA -> turnosDelDia(ctx, args);
            default -> throw new ToolException("UNKNOWN_TOOL");
          };
      return ToolOutcome.of(objectMapper.writeValueAsString(Map.of("data", data)));
    } catch (ToolException e) {
      return ToolOutcome.of(error(e.getMessage(), e.extra()));
    } catch (AssistantDraftException e) {
      return ToolOutcome.of(error(e.code(), Map.of()));
    } catch (org.springframework.web.server.ResponseStatusException e) {
      // A service refused (unknown client, inactive professional…): its code goes to the model.
      return ToolOutcome.of(error(e.getReason() == null ? "TOOL_FAILED" : e.getReason()));
    } catch (RuntimeException e) {
      // Never log arguments or results: they hold client data.
      log.error("assistant tool failed tool={} tenantId={}", name, ctx.tenantId(), e);
      return ToolOutcome.of(error("TOOL_FAILED"));
    }
  }

  // ---------------------------------------------------------------------------------------------

  private Object buscarClientes(AssistantContext ctx, JsonNode args) {
    String query = text(args, "query");
    if (query == null || query.length() < 2) {
      throw new ToolException("QUERY_TOO_SHORT");
    }
    List<ClientResponse> found = clientService.search(ctx.tenantId(), query, null, null, null);
    if (ctx.isProfessional()) {
      // HU-68 AC12: a professional sees names only and searches by name only.
      found = ClientService.nameOnlyForProfessional(found, query);
    }
    List<Map<String, Object>> rows =
        found.stream()
            .limit(MAX_CLIENTS)
            .map(
                c -> {
                  Map<String, Object> row = new LinkedHashMap<>();
                  row.put("id", c.id());
                  row.put("fullName", c.fullName());
                  row.put("active", c.active());
                  if (!ctx.isProfessional()) {
                    row.put("phone", c.phone());
                    row.put("ruc", c.ruc());
                  }
                  return row;
                })
            .toList();
    return page("clients", rows, found.size());
  }

  private Object listarServicios(AssistantContext ctx, JsonNode args) {
    String query = text(args, "query");
    var services =
        serviceCatalogService.listServices(ctx.tenantId(), Optional.empty(), query, "SERVICE");
    List<Map<String, Object>> rows =
        services.stream()
            .filter(s -> s.active())
            .limit(MAX_SERVICES)
            .map(
                s -> {
                  Map<String, Object> row = new LinkedHashMap<>();
                  row.put("id", s.id());
                  row.put("name", s.name());
                  // The listing format is fixed: name and price, nothing else (HU-AST-02 AC6).
                  row.put("price", AssistantMoney.gs(s.priceMinor()));
                  return row;
                })
            .toList();
    return page("services", rows, (int) services.stream().filter(s -> s.active()).count());
  }

  private Object listarProfesionales(AssistantContext ctx) {
    List<Map<String, Object>> rows =
        professionalDirectoryService.listOptions(ctx.tenantId()).stream()
            .filter(p -> p.active())
            .map(
                p -> {
                  Map<String, Object> row = new LinkedHashMap<>();
                  row.put("id", p.id());
                  row.put("name", p.displayName());
                  return row;
                })
            .toList();
    return page("professionals", rows, rows.size());
  }

  private Object turnosDelDia(AssistantContext ctx, JsonNode args) {
    ZoneId zone = timeProperties.zoneId();
    LocalDate date = resolveDate(text(args, "date"), zone);
    Long clientId = longArg(args, "clientId");
    Long professionalId = longArg(args, "professionalId");
    Instant from = date.atStartOfDay(zone).toInstant();
    Instant to = date.plusDays(1).atStartOfDay(zone).toInstant();

    List<AppointmentResponse> all =
        appointmentService.list(ctx.tenantId(), from, to, professionalId, clientId);
    List<Map<String, Object>> rows =
        all.stream()
            .limit(MAX_APPOINTMENTS)
            .map(
                a -> {
                  Map<String, Object> row = new LinkedHashMap<>();
                  row.put("id", a.id());
                  row.put("start", Instant.parse(a.startAt()).atZone(zone).format(HH_MM));
                  row.put("end", Instant.parse(a.endAt()).atZone(zone).format(HH_MM));
                  row.put("clientId", a.clientId());
                  row.put("clientName", a.clientName());
                  row.put("professionalId", a.professionalId());
                  row.put("professionalName", a.professionalName());
                  row.put("serviceName", a.serviceName());
                  row.put("status", a.status());
                  return row;
                })
            .toList();
    Map<String, Object> out = page("appointments", rows, all.size());
    out.put("date", date.toString());
    return out;
  }

  // ---------------------------------------------------------------------------------------------

  /**
   * Accepts ISO dates plus {@code hoy}/{@code mañana} (and English) resolved in the business zone.
   */
  LocalDate resolveDate(String raw, ZoneId zone) {
    if (raw == null || raw.isBlank()) {
      throw new ToolException("INVALID_DATE");
    }
    String s = fold(raw);
    LocalDate today = LocalDate.now(zone);
    switch (s) {
      case "hoy", "today":
        return today;
      case "manana", "tomorrow":
        return today.plusDays(1);
      case "ayer", "yesterday":
        return today.minusDays(1);
      default:
        try {
          return LocalDate.parse(raw.trim());
        } catch (DateTimeParseException e) {
          throw new ToolException("INVALID_DATE");
        }
    }
  }

  private static String fold(String s) {
    return Normalizer.normalize(s.trim().toLowerCase(Locale.ROOT), Normalizer.Form.NFD)
        .replaceAll("\\p{M}", "");
  }

  private static Map<String, Object> page(String key, List<Map<String, Object>> rows, int total) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put(key, rows);
    out.put("count", rows.size());
    out.put("truncated", total > rows.size());
    return out;
  }

  private String error(String code) {
    return error(code, Map.of());
  }

  private String error(String code, Map<String, Object> extra) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("error", code);
    body.putAll(extra);
    return objectMapper.writeValueAsString(body);
  }

  private static String text(JsonNode args, String field) {
    JsonNode n = args.get(field);
    return n == null || n.isNull() || n.asString().isBlank() ? null : n.asString().trim();
  }

  private static Long longArg(JsonNode args, String field) {
    JsonNode n = args.get(field);
    if (n == null || n.isNull()) {
      return null;
    }
    if (!n.canConvertToLong()) {
      throw new ToolException("INVALID_ARGUMENTS");
    }
    return n.asLong();
  }

  static String schema(String properties, String required) {
    return "{\"type\":\"object\",\"properties\":"
        + properties
        + ",\"required\":"
        + required
        + ",\"additionalProperties\":false}";
  }

  /** A tool refused its input; the code (and any hints) go back to the model, not to the user. */
  static final class ToolException extends RuntimeException {
    private final transient Map<String, Object> extra;

    ToolException(String code) {
      this(code, Map.of());
    }

    ToolException(String code, Map<String, Object> extra) {
      super(code);
      this.extra = extra;
    }

    Map<String, Object> extra() {
      return extra;
    }
  }
}
