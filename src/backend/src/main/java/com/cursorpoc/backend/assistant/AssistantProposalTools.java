package com.cursorpoc.backend.assistant;

import com.cursorpoc.backend.assistant.AssistantDraftPayloads.InvoiceDraftPayload;
import com.cursorpoc.backend.assistant.AssistantModelClient.ToolSpec;
import com.cursorpoc.backend.assistant.ToolOutcome.CardEvent;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * The tools that PROPOSE: they create a draft that lives only in the chat. None of them writes
 * business data — turning a draft into an invoice or an appointment is a button (an endpoint), not
 * a tool, so the model has no way to do it. The card the person sees is built here from the draft
 * the backend priced, not from anything the model said.
 */
@Component
public class AssistantProposalTools {

  static final String PROPONER_FACTURA = "proponer_factura";
  static final String DESCARTAR_BORRADOR = "descartar_borrador";

  static final String EVENT_DRAFT = "card.draft";
  static final String EVENT_DRAFT_UPDATED = "card.draft.updated";

  private final AssistantInvoiceDrafts invoiceDrafts;
  private final AssistantDraftService draftService;
  private final ObjectMapper objectMapper;

  public AssistantProposalTools(
      AssistantInvoiceDrafts invoiceDrafts,
      AssistantDraftService draftService,
      ObjectMapper objectMapper) {
    this.invoiceDrafts = invoiceDrafts;
    this.draftService = draftService;
    this.objectMapper = objectMapper;
  }

  boolean handles(String name) {
    return PROPONER_FACTURA.equals(name) || DESCARTAR_BORRADOR.equals(name);
  }

  /** Invoicing is ADMIN-only in the app (/api/invoices), so only an administrator is offered it. */
  List<ToolSpec> specsFor(AssistantContext ctx) {
    List<ToolSpec> specs = new ArrayList<>();
    if (ctx.isAdmin()) {
      specs.add(
          new ToolSpec(
              PROPONER_FACTURA,
              "Prepara un BORRADOR de factura para un cliente; no emite nada: la persona lo revisa y"
                  + " lo confirma con un botón. Sin serviceIds toma la ficha abierta del cliente o su"
                  + " único turno de hoy. El precio y el total los calcula el sistema; solo si la persona"
                  + " DIJO un precio para un servicio, pasalo en prices (nunca inventes uno).",
              AssistantTools.schema(
                  "{\"clientId\":{\"type\":\"integer\",\"description\":\"Id del cliente"
                      + " (buscar_clientes)\"},"
                      + "\"serviceIds\":{\"type\":\"array\",\"items\":{\"type\":\"integer\"},"
                      + "\"description\":\"Ids de servicios a cobrar; repetir un id para cantidad"
                      + " 2\"},"
                      + "\"prices\":{\"type\":\"array\",\"description\":\"Precio unitario que la persona"
                      + " dijo para un servicio, en guaraníes enteros y sin puntos (45000)\","
                      + "\"items\":{\"type\":\"object\",\"properties\":{\"serviceId\":{\"type\":\"integer\"},"
                      + "\"unitPrice\":{\"type\":\"integer\"}},\"required\":[\"serviceId\",\"unitPrice\"]}},"
                      + "\"appointmentId\":{\"type\":\"integer\"},"
                      + "\"professionalId\":{\"type\":\"integer\"},"
                      + "\"paymentMethod\":{\"type\":\"string\",\"enum\":[\"CASH\",\"DEBIT_CARD\","
                      + "\"CREDIT_CARD\",\"TRANSFER\"]},"
                      + "\"email\":{\"type\":\"string\"}}",
                  "[\"clientId\"]")));
    }
    specs.add(
        new ToolSpec(
            DESCARTAR_BORRADOR,
            "Descarta el borrador activo de esta conversación cuando la persona lo pide.",
            AssistantTools.schema("{}", "[]")));
    return specs;
  }

  ToolOutcome run(AssistantContext ctx, String name, JsonNode args) {
    if (ctx.conversationId() == null) {
      throw new AssistantTools.ToolException("NO_CONVERSATION");
    }
    return switch (name) {
      case PROPONER_FACTURA -> proponerFactura(ctx, args);
      case DESCARTAR_BORRADOR -> descartar(ctx);
      default -> throw new AssistantTools.ToolException("UNKNOWN_TOOL");
    };
  }

  /** Unit prices by service id, as the person said them; anything malformed is a bad call. */
  private static Map<Long, java.math.BigDecimal> prices(JsonNode args) {
    JsonNode node = args.get("prices");
    if (node == null || node.isNull()) {
      return null;
    }
    if (!node.isArray()) {
      throw new AssistantTools.ToolException("INVALID_ARGUMENTS");
    }
    Map<Long, java.math.BigDecimal> out = new LinkedHashMap<>();
    for (JsonNode item : node) {
      JsonNode id = item.get("serviceId");
      JsonNode price = item.get("unitPrice");
      if (id == null || !id.canConvertToLong() || price == null) {
        throw new AssistantTools.ToolException("INVALID_ARGUMENTS");
      }
      try {
        // «45000» or «"45.000"» (Spanish thousands separator); a comma would be a decimal: invalid.
        out.put(
            id.asLong(),
            price.isNumber()
                ? price.decimalValue()
                : new java.math.BigDecimal(price.asString().replace(".", "").trim()));
      } catch (NumberFormatException e) {
        throw new AssistantTools.ToolException("INVALID_PRICE");
      }
    }
    return out;
  }

  private ToolOutcome proponerFactura(AssistantContext ctx, JsonNode args) {
    if (!ctx.isAdmin()) {
      throw new AssistantTools.ToolException("FORBIDDEN");
    }
    List<Long> serviceIds = new ArrayList<>();
    JsonNode ids = args.get("serviceIds");
    if (ids != null && ids.isArray()) {
      ids.forEach(
          n -> {
            if (!n.canConvertToLong()) {
              throw new AssistantTools.ToolException("INVALID_ARGUMENTS");
            }
            serviceIds.add(n.asLong());
          });
    }
    InvoiceDraftPayload payload =
        invoiceDrafts.build(
            ctx.tenantId(),
            new AssistantInvoiceDrafts.Request(
                longArg(args, "clientId"),
                serviceIds,
                longArg(args, "professionalId"),
                longArg(args, "appointmentId"),
                text(args, "paymentMethod"),
                text(args, "email"),
                prices(args)));
    AssistantDraftService.Created created = draftService.createInvoiceDraft(ctx, payload);

    List<CardEvent> cards = new ArrayList<>();
    for (String old : created.supersededIds()) {
      cards.add(new CardEvent(EVENT_DRAFT_UPDATED, Map.of("id", old, "status", "SUPERSEDED")));
    }
    cards.add(new CardEvent(EVENT_DRAFT, created.draft()));

    // What the model may say about it: names and amounts the backend computed, and the rule that
    // only the person's button issues anything.
    Map<String, Object> data = new LinkedHashMap<>();
    data.put("draftId", created.draft().id());
    data.put("status", "DRAFT");
    data.put("client", payload.clientName());
    data.put("total", AssistantMoney.gs(payload.total()));
    List<Map<String, Object>> lines = new ArrayList<>();
    for (InvoiceDraftPayload.Line l : payload.lines()) {
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("name", l.name());
      row.put("quantity", l.quantity());
      row.put("price", AssistantMoney.gs(l.unitPrice()));
      lines.add(row);
    }
    data.put("lines", lines);
    data.put("missing", created.draft().missing());
    data.put(
        "instruction",
        "El borrador YA aparece en una tarjeta con el botón «Confirmar y emitir»: no lo describas"
            + " línea por línea. Decile a la persona que lo revise y lo confirme con ese botón; lo que"
            + " falta (`missing`) lo completa en la tarjeta. Todavía NO se emitió nada: nunca digas"
            + " que ya está facturado.");
    return new ToolOutcome(
        objectMapper.writeValueAsString(Map.of("data", data)), List.copyOf(cards));
  }

  private ToolOutcome descartar(AssistantContext ctx) {
    List<AssistantDraftDto> discarded =
        draftService.discardActive(ctx.tenantId(), ctx.userId(), ctx.conversationId());
    if (discarded.isEmpty()) {
      throw new AssistantTools.ToolException("NO_ACTIVE_DRAFT");
    }
    List<CardEvent> cards = new ArrayList<>();
    for (AssistantDraftDto d : discarded) {
      cards.add(new CardEvent(EVENT_DRAFT_UPDATED, Map.of("id", d.id(), "status", "DISCARDED")));
    }
    return new ToolOutcome(
        objectMapper.writeValueAsString(Map.of("data", Map.of("discarded", discarded.size()))),
        List.copyOf(cards));
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
