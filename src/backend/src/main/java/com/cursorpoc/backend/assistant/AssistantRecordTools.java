package com.cursorpoc.backend.assistant;

import com.cursorpoc.backend.assistant.AssistantDraftPayloads.ServiceRecordDraftPayload;
import com.cursorpoc.backend.assistant.AssistantModelClient.ToolSpec;
import com.cursorpoc.backend.assistant.ToolOutcome.CardEvent;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * The ficha de servicio tools: {@code ver_ficha_abierta} reads, {@code proponer_ficha} prepares a
 * DRAFT of the ficha (created or changed). Like the other proposals nothing is written here: the
 * ficha exists or changes only after the person presses «Guardar ficha». Both roles use them; the
 * professional gets no amounts anywhere (see {@link AssistantRecordDrafts}).
 */
@Component
public class AssistantRecordTools {

  static final String VER_FICHA_ABIERTA = "ver_ficha_abierta";
  static final String PROPONER_FICHA = "proponer_ficha";

  private static final String ITEM_PRICE =
      "\"unitPrice\":{\"type\":\"integer\",\"description\":\"Precio unitario que la persona DIJO,"
          + " en guaraníes enteros y sin puntos (45000). Nunca inventes uno\"},";

  private final AssistantRecordDrafts drafts;
  private final AssistantDraftService draftService;
  private final ObjectMapper objectMapper;

  public AssistantRecordTools(
      AssistantRecordDrafts drafts, AssistantDraftService draftService, ObjectMapper objectMapper) {
    this.drafts = drafts;
    this.draftService = draftService;
    this.objectMapper = objectMapper;
  }

  boolean handles(String name) {
    return VER_FICHA_ABIERTA.equals(name) || PROPONER_FICHA.equals(name);
  }

  List<ToolSpec> specsFor(AssistantContext ctx) {
    boolean price = ctx.isAdmin(); // a professional never sees nor sets money
    return List.of(
        new ToolSpec(
            VER_FICHA_ABIERTA,
            "Muestra las fichas de servicio abiertas de un cliente (líneas numeradas: esas posiciones"
                + " son las que usás para quitar o cambiar) y sus turnos de hoy. Si hay una tarjeta"
                + " de ficha sin guardar, muestra esa lista.",
            AssistantTools.schema(
                "{\"clientId\":{\"type\":\"integer\",\"description\":\"Id del cliente"
                    + " (buscar_clientes)\"}}",
                "[\"clientId\"]")),
        new ToolSpec(
            PROPONER_FICHA,
            "Prepara un BORRADOR para crear la ficha de servicio de un cliente o cambiar su ficha"
                + " abierta; no guarda nada: la persona lo revisa y lo guarda con el botón «Guardar"
                + " ficha». Pasá SOLO los cambios: agregar, quitar (por posición) y cambiar. Si el"
                + " cliente tiene un turno hoy sin ficha, la ficha se crea ligada a ese turno.",
            AssistantTools.schema(
                "{\"clientId\":{\"type\":\"integer\",\"description\":\"Id del cliente"
                    + " (buscar_clientes)\"},"
                    + "\"appointmentId\":{\"type\":\"integer\",\"description\":\"Turno de hoy al que"
                    + " ligar la ficha nueva, si hay varios\"},"
                    + "\"recordId\":{\"type\":\"integer\",\"description\":\"Ficha a editar, cuando"
                    + " hay varias abiertas o es de un día anterior\"},"
                    + "\"newRecord\":{\"type\":\"boolean\",\"description\":\"true para abrir una ficha"
                    + " nueva aunque haya otra abierta de un día anterior\"},"
                    + "\"agregar\":{\"type\":\"array\",\"description\":\"Servicios o productos a"
                    + " agregar\",\"items\":{\"type\":\"object\",\"properties\":{"
                    + "\"id\":{\"type\":\"integer\"},"
                    + "\"quantity\":{\"type\":\"integer\",\"minimum\":1},"
                    + "\"professionalId\":{\"type\":\"integer\"},"
                    + (price ? ITEM_PRICE : "")
                    + "},\"required\":[\"id\"]}},"
                    + "\"quitar\":{\"type\":\"array\",\"description\":\"Posiciones de las líneas a"
                    + " quitar\",\"items\":{\"type\":\"integer\"}},"
                    + "\"cambiar\":{\"type\":\"array\",\"description\":\"Cambios a una línea por su"
                    + " posición\",\"items\":{\"type\":\"object\",\"properties\":{"
                    + "\"position\":{\"type\":\"integer\"},"
                    + "\"quantity\":{\"type\":\"integer\",\"minimum\":1},"
                    + "\"professionalId\":{\"type\":\"integer\"},"
                    + (price ? ITEM_PRICE : "")
                    + "},\"required\":[\"position\"]}}}",
                "[\"clientId\"]")));
  }

  ToolOutcome run(AssistantContext ctx, String name, JsonNode args) {
    return switch (name) {
      case VER_FICHA_ABIERTA -> ver(ctx, args);
      case PROPONER_FICHA -> proponer(ctx, args);
      default -> throw new AssistantTools.ToolException("UNKNOWN_TOOL");
    };
  }

  private ToolOutcome ver(AssistantContext ctx, JsonNode args) {
    Long clientId = longArg(args, "clientId");
    if (clientId == null) {
      throw new AssistantTools.ToolException("CLIENT_REQUIRED");
    }
    Map<String, Object> view = drafts.view(ctx, clientId, draftService.activeRecordPayload(ctx));
    return ToolOutcome.of(objectMapper.writeValueAsString(Map.of("data", view)));
  }

  private ToolOutcome proponer(AssistantContext ctx, JsonNode args) {
    if (ctx.conversationId() == null) {
      throw new AssistantTools.ToolException("NO_CONVERSATION");
    }
    AssistantRecordDrafts.Request request = request(args);
    Optional<ServiceRecordDraftPayload> pending = draftService.activeRecordPayload(ctx);
    ServiceRecordDraftPayload payload = drafts.build(ctx, request, pending);
    AssistantDraftService.Created created = draftService.createRecordDraft(ctx, payload);

    List<CardEvent> cards = new ArrayList<>();
    for (String old : created.supersededIds()) {
      cards.add(
          new CardEvent(
              AssistantProposalTools.EVENT_DRAFT_UPDATED,
              Map.of("id", old, "status", "SUPERSEDED")));
    }
    cards.add(new CardEvent(AssistantProposalTools.EVENT_DRAFT, created.draft()));

    // What the model may say: names the backend resolved, and amounts only for the role that sees
    // them.
    Map<String, Object> data = new LinkedHashMap<>();
    data.put("draftId", created.draft().id());
    data.put("status", "DRAFT");
    data.put("client", payload.clientName());
    data.put("newRecord", payload.serviceRecordId() == null);
    if (payload.appointmentTime() != null) {
      data.put("linkedAppointmentAt", payload.appointmentTime());
    }
    List<Map<String, Object>> lines = new ArrayList<>();
    for (ServiceRecordDraftPayload.Line l : payload.lines()) {
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("position", l.position());
      row.put("name", l.name());
      row.put("quantity", l.quantity());
      row.put("professionalName", l.professionalName());
      row.put("mark", l.mark());
      if (l.unitPrice() != null) {
        row.put("price", AssistantMoney.gs(l.unitPrice()));
      }
      lines.add(row);
    }
    data.put("lines", lines);
    if (payload.total() != null) {
      data.put("total", AssistantMoney.gs(payload.total()));
    }
    if (!payload.notApplied().isEmpty()) {
      data.put("notApplied", payload.notApplied());
    }
    data.put(
        "instruction",
        "El borrador YA aparece en una tarjeta con el botón «Guardar ficha»: no lo describas línea"
            + " por línea. Decile a la persona que lo revise y lo guarde con ese botón."
            + " Todavía NO se guardó nada: nunca digas que la ficha ya está guardada.");
    return new ToolOutcome(
        objectMapper.writeValueAsString(Map.of("data", data)), List.copyOf(cards));
  }

  // ---------------------------------------------------------------------------------------------
  // Arguments: anything malformed is a bad call, never a guess

  private static AssistantRecordDrafts.Request request(JsonNode args) {
    List<AssistantRecordDrafts.Add> add = new ArrayList<>();
    for (JsonNode n : array(args, "agregar")) {
      Long id = requiredLong(n, "id");
      add.add(
          new AssistantRecordDrafts.Add(
              id,
              n.has("quantity") && !n.get("quantity").isNull() ? intValue(n.get("quantity")) : 1,
              longArg(n, "professionalId"),
              price(n)));
    }
    List<Integer> remove = new ArrayList<>();
    for (JsonNode n : array(args, "quitar")) {
      remove.add(intValue(n));
    }
    List<AssistantRecordDrafts.ChangeReq> change = new ArrayList<>();
    for (JsonNode n : array(args, "cambiar")) {
      JsonNode quantity = n.get("quantity");
      change.add(
          new AssistantRecordDrafts.ChangeReq(
              intValue(requiredNode(n, "position")),
              quantity == null || quantity.isNull() ? null : intValue(quantity),
              longArg(n, "professionalId"),
              price(n)));
    }
    JsonNode newRecord = args.get("newRecord");
    return new AssistantRecordDrafts.Request(
        longArg(args, "clientId"),
        longArg(args, "appointmentId"),
        longArg(args, "recordId"),
        newRecord != null && newRecord.isBoolean() && newRecord.asBoolean(),
        add,
        remove,
        change);
  }

  private static List<JsonNode> array(JsonNode args, String field) {
    JsonNode node = args.get(field);
    if (node == null || node.isNull()) {
      return List.of();
    }
    if (!node.isArray()) {
      throw new AssistantTools.ToolException("INVALID_ARGUMENTS");
    }
    List<JsonNode> out = new ArrayList<>();
    node.forEach(out::add);
    return out;
  }

  private static JsonNode requiredNode(JsonNode node, String field) {
    JsonNode n = node.get(field);
    if (n == null || n.isNull()) {
      throw new AssistantTools.ToolException("INVALID_ARGUMENTS");
    }
    return n;
  }

  private static Long requiredLong(JsonNode node, String field) {
    JsonNode n = requiredNode(node, field);
    if (!n.canConvertToLong()) {
      throw new AssistantTools.ToolException("INVALID_ARGUMENTS");
    }
    return n.asLong();
  }

  private static int intValue(JsonNode n) {
    // «1.5» would be silently cut to 1: a quantity or a position is a whole number.
    if (n == null || !n.isIntegralNumber() || !n.canConvertToInt()) {
      throw new AssistantTools.ToolException("INVALID_ARGUMENTS");
    }
    return n.asInt();
  }

  private static Long longArg(JsonNode node, String field) {
    JsonNode n = node.get(field);
    if (n == null || n.isNull()) {
      return null;
    }
    if (!n.canConvertToLong()) {
      throw new AssistantTools.ToolException("INVALID_ARGUMENTS");
    }
    return n.asLong();
  }

  /** «45000» or «"45.000"» (Spanish thousands separator); a comma would be a decimal: invalid. */
  private static BigDecimal price(JsonNode node) {
    JsonNode n = node.get("unitPrice");
    if (n == null || n.isNull()) {
      return null;
    }
    try {
      if (n.isNumber() && !n.isIntegralNumber()) {
        throw new NumberFormatException("whole guaraníes only");
      }
      return n.isNumber() ? n.decimalValue() : new BigDecimal(n.asString().replace(".", "").trim());
    } catch (NumberFormatException e) {
      throw new AssistantTools.ToolException("INVALID_PRICE");
    }
  }
}
