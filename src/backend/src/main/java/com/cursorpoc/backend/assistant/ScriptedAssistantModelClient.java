package com.cursorpoc.backend.assistant;

import com.cursorpoc.backend.assistant.AssistantModelClient.ChatTurn.Kind;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.function.Consumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Deterministic stand-in for the model ({@code app.femme.assistant.model=fake}, profiles {@code
 * e2e} and {@code test}). It decides by PATTERNS in the user's text — so Playwright runs never
 * touch Foundry — but goes through the real orchestrator, tools and SSE path, and asks for tools
 * exactly as a real model would:
 *
 * <ul>
 *   <li>{@code "falla modelo"} / {@code "model fails"} → the model is unavailable (error path)
 *   <li>{@code "turnos de <nombre>"} → {@code buscar_clientes}, then {@code turnos_del_dia} for the
 *       first client found (a two-round tool loop)
 *   <li>{@code "turnos"} (+ {@code mañana} or {@code yyyy-MM-dd}, default today) → {@code
 *       turnos_del_dia}
 *   <li>{@code "busca <texto>"} → {@code buscar_clientes}
 *   <li>{@code "servicios"} → {@code listar_servicios}; {@code "profesionales"} → {@code
 *       listar_profesionales}
 *   <li>{@code "record <client> [new] [rec=ID] [apt=ID] [add <item> [xN] [at P] | remove N | set N
 *       xQ | set N with <professional>]"} → {@code buscar_clientes}, then {@code ver_ficha_abierta}
 *       (no change) or {@code proponer_ficha}
 *   <li>anything else → a «no entendí» answer without tools
 * </ul>
 *
 * Adding «slowly» or «despacio» to a question makes the answer trickle out in pieces (400 ms apart)
 * so a browser test can watch it being written.
 *
 * <p>Keywords work in Spanish and English (Playwright forces the UI language to English, so the
 * suggestion chips it clicks send English text). After a tool result it answers — in Spanish, like
 * the real model — with a plain summary of the returned data.
 */
@Component
@ConditionalOnProperty(name = "app.femme.assistant.model", havingValue = "fake")
public class ScriptedAssistantModelClient implements AssistantModelClient {

  static final String FALLBACK =
      "No entendí tu consulta. Puedo mostrarte los turnos del día, buscar clientes y listar"
          + " servicios o profesionales.";

  private static final Pattern ISO_DATE = Pattern.compile("\\d{4}-\\d{2}-\\d{2}");
  private static final Pattern SEARCH =
      Pattern.compile(
          "(?i)\\b(?:busca(?:r|me)?|search(?: for)?|find)\\s+(?:a\\s+|al\\s+|la\\s+|los\\s+)?(.+)$");
  private static final Pattern APPOINTMENTS_OF =
      Pattern.compile(
          "(?i)\\b(?:turnos|appointments)\\s+(?:de|of|for)\\s+(?!hoy|today|manana|mañana|tomorrow)"
              + "(.+?)(?:\\s+(?:para|de|for|on)\\s+(?:hoy|today|manana|mañana|tomorrow|\\d{4}-\\d{2}-\\d{2}))?\\W*$");

  /** «invoice <client> [for <service>]» / «factura(le) a <cliente> [por|con <servicio>]». */
  private static final Pattern INVOICE =
      Pattern.compile(
          "(?i)\\b(?:invoice|bill|factura(?:r|le)?)\\s+(?:a\\s+|to\\s+|for\\s+)?(.+?)"
              + "(?:\\s+(?:for|por|con|with)\\s+(.+?))?\\s*$");

  /** «availability [tomorrow] [morning] for <service> [with <professional>]». */
  private static final Pattern AVAILABILITY =
      Pattern.compile(
          "(?i)\\b(?:availability|available|disponibilidad)\\b.*?\\b(?:for|para)\\s+(.+?)"
              + "(?:\\s+(?:with|con)\\s+(.+?))?\\s*$");

  /** «book <client> for <service> [today|tomorrow|date] at HH:mm [with <professional>]». */
  private static final Pattern BOOK =
      Pattern.compile(
          "(?i)\\b(?:book|schedule|agend\\w*)\\s+(.+?)\\s+(?:for|para)\\s+(.+?)"
              + "(?:\\s+(?:today|tomorrow|hoy|manana|mañana|\\d{4}-\\d{2}-\\d{2}))?"
              + "\\s+(?:at|a\\s+las)\\s+(\\d{1,2}:\\d{2})(?:\\s+(?:with|con)\\s+(.+?))?\\s*$");

  /** The message a tapped time chip sends (see AssistantAgendaTools). */
  private static final Pattern SLOT_CHIP =
      Pattern.compile("(?i)quiero el turno del (\\d{4}-\\d{2}-\\d{2}) a las (\\d{1,2}:\\d{2})");

  /** «add <item> [x2] [at <amount>]» / «agregale <item>»: more items on the draft in progress. */
  private static final Pattern ADD =
      Pattern.compile("(?i)^\\s*(?:add|agrega(?:r|le)?)\\s+(.+?)\\s*$");

  /** «Shampoo x2» / «Shampoo ×2»: how many. */
  private static final Pattern QUANTITY = Pattern.compile("(?i)\\s+[x×]\\s*(\\d{1,2})\\s*$");

  private static final Pattern DISCARD =
      Pattern.compile("(?i)\\b(?:discard|descart\\w*)\\b.*\\b(?:draft|borrador)\\b");

  /** «record <client> …» / «ficha <cliente> …»: read, open or change the client's ficha. */
  private static final Pattern RECORD = Pattern.compile("(?i)^\\s*(?:record|ficha)\\s+(.+?)\\s*$");

  private static final Pattern RECORD_OP =
      Pattern.compile("(?i)^(.+?)\\s+(add|agrega|remove|quita|set|cambia)\\s+(.+)$");
  private static final Pattern REC_ID = Pattern.compile("(?i)\\brec=(\\d+)");
  private static final Pattern APT_ID = Pattern.compile("(?i)\\bapt=(\\d+)");
  private static final Pattern NEW_FLAG = Pattern.compile("(?i)\\bnew\\b");
  private static final Pattern LEADING_NUMBER = Pattern.compile("^(\\d+)");
  private static final Pattern SET_PROFESSIONAL =
      Pattern.compile("(?i)^(\\d+)\\s+(?:with|con)\\s+(.+)$");
  private static final Pattern SET_QUANTITY = Pattern.compile("(?i)^(\\d+)\\s+[x×]\\s*(\\d{1,2})$");

  private static final int CHUNK = 16;

  /** With «slowly» / «despacio» in the question the answer trickles out, for streaming e2e. */
  private static final long SLOW_CHUNK_PAUSE_MS = 400;

  private final ObjectMapper objectMapper;

  public ScriptedAssistantModelClient(ObjectMapper objectMapper) {
    this.objectMapper = objectMapper;
  }

  @Override
  public void streamTurn(ModelRequest request, Consumer<ModelEvent> sink) {
    List<ChatTurn> turns = request.turns();
    ChatTurn last = turns.get(turns.size() - 1);
    String userText = lastUserText(turns);
    boolean slow = isSlow(fold(userText));

    if (last.kind() == Kind.TOOL_RESULTS) {
      answerFromToolResults(turns, last, userText, slow, sink);
      return;
    }
    String folded = fold(userText);
    if (folded.contains("falla modelo") || folded.contains("model fails")) {
      throw new AssistantModelException("scripted failure");
    }
    Matcher of = APPOINTMENTS_OF.matcher(userText.trim());
    Matcher invoice = INVOICE.matcher(userText.trim());
    Matcher book = BOOK.matcher(userText.trim());
    Matcher avail = AVAILABILITY.matcher(userText.trim());
    RecordIntent record = recordIntent(userText.trim());
    if (DISCARD.matcher(userText).find()) {
      requestTool(sink, "descartar_borrador", "{}");
    } else if (record != null) {
      requestTool(sink, "buscar_clientes", "{\"query\":" + quote(record.client()) + "}");
    } else if (SLOT_CHIP.matcher(userText).find()) {
      say(sink, slow, "¿Para qué cliente querés agendar ese horario?");
    } else if (ADD.matcher(userText).matches()) {
      Matcher add = ADD.matcher(userText);
      add.matches();
      requestTool(sink, "listar_servicios", "{\"query\":" + quote(itemName(add.group(1))) + "}");
    } else if (book.find()) {
      requestTool(sink, "buscar_clientes", "{\"query\":" + quote(book.group(1).trim()) + "}");
    } else if (avail.find()) {
      requestTool(
          sink, "listar_servicios", "{\"query\":" + quote(withoutDayPart(avail.group(1))) + "}");
    } else if (invoice.find()) {
      requestTool(
          sink, "buscar_clientes", "{\"query\":" + quote(withoutPayment(invoice.group(1))) + "}");
    } else if (isAppointments(folded) && of.find()) {
      requestTool(sink, "buscar_clientes", "{\"query\":" + quote(of.group(1).trim()) + "}");
    } else if (isAppointments(folded)) {
      requestTool(sink, "turnos_del_dia", "{\"date\":" + quote(dateOf(folded, userText)) + "}");
    } else if (SEARCH.matcher(userText.trim()).find()) {
      Matcher m = SEARCH.matcher(userText.trim());
      m.find();
      requestTool(sink, "buscar_clientes", "{\"query\":" + quote(m.group(1).trim()) + "}");
    } else if (folded.contains("servicios") || folded.contains("services")) {
      requestTool(sink, "listar_servicios", "{}");
    } else if (folded.contains("productos") || folded.contains("products")) {
      requestTool(sink, "listar_productos", "{}");
    } else if (folded.contains("profesionales") || folded.contains("professionals")) {
      requestTool(sink, "listar_profesionales", "{}");
    } else {
      say(sink, slow, FALLBACK);
    }
  }

  // ---------------------------------------------------------------------------------------------

  private void answerFromToolResults(
      List<ChatTurn> turns,
      ChatTurn results,
      String userText,
      boolean slow,
      Consumer<ModelEvent> sink) {
    ToolResult r = results.toolResults().get(0);
    JsonNode root = objectMapper.readTree(r.content());
    RecordIntent record = recordIntent(userText.trim());
    if (record != null) {
      answerRecord(record, turns, r, root, slow, sink);
      return;
    }
    Matcher invoice = INVOICE.matcher(userText.trim());
    boolean invoicing = invoice.find();
    if (r.name().equals("proponer_factura")
        || r.name().equals("agregar_item_a_borrador")
        || r.name().equals("descartar_borrador")
        || r.name().equals("proponer_turno")) {
      answerProposal(r.name(), root, slow, sink);
      return;
    }
    Matcher book = BOOK.matcher(userText.trim());
    boolean booking = book.find();
    Matcher avail = AVAILABILITY.matcher(userText.trim());
    boolean checking = !booking && avail.find();
    if (r.name().equals("consultar_disponibilidad")) {
      say(sink, slow, availabilityText(root));
      return;
    }
    if ((booking || checking) && !root.has("error")) {
      JsonNode data0 = root.get("data");
      if (booking && r.name().equals("buscar_clientes")) {
        if (data0.get("clients").isEmpty()) {
          say(sink, slow, "No encontré clientes con ese nombre.");
        } else {
          requestTool(sink, "listar_servicios", "{\"query\":" + quote(book.group(2).trim()) + "}");
        }
        return;
      }
      if (r.name().equals("listar_servicios")) {
        JsonNode services = data0.get("services");
        String proName = booking ? book.group(4) : avail.group(2);
        if (services.isEmpty()) {
          say(sink, slow, "No encontré ese servicio.");
        } else if (proName != null && !proName.isBlank()) {
          requestTool(sink, "listar_profesionales", "{}");
        } else {
          requestAgenda(
              sink, turns, userText, booking, book, null, services.get(0).get("id").asLong());
        }
        return;
      }
      if (r.name().equals("listar_profesionales")) {
        String proName = booking ? book.group(4) : avail.group(2);
        Long proId = null;
        for (JsonNode p : data0.get("professionals")) {
          if (fold(p.get("name").asString()).contains(fold(proName.trim()))) {
            proId = p.get("id").asLong();
            break;
          }
        }
        Long serviceId = serviceIdFromEarlierList(turns);
        if (proId == null || serviceId == null) {
          say(sink, slow, "No encontré a ese profesional.");
        } else {
          requestAgenda(sink, turns, userText, booking, book, proId, serviceId);
        }
        return;
      }
    }
    if (root.has("error")) {
      say(sink, slow, "No pude consultar ese dato.");
      return;
    }
    JsonNode data = root.get("data");
    if (invoicing && r.name().equals("buscar_clientes") && !data.get("clients").isEmpty()) {
      long clientId = data.get("clients").get(0).get("id").asLong();
      String service = invoice.group(2) == null ? null : itemName(invoice.group(2));
      if (service != null && !service.isBlank()) {
        requestTool(sink, "listar_servicios", "{\"query\":" + quote(service) + "}");
      } else {
        requestTool(sink, "proponer_factura", invoiceArgs(clientId, null, 1, userText));
      }
      return;
    }
    Matcher add = ADD.matcher(userText);
    boolean adding = add.matches();
    boolean catalogLookup =
        r.name().equals("listar_servicios") || r.name().equals("listar_productos");
    if ((invoicing || adding) && catalogLookup) {
      JsonNode found = data.get(r.name().equals("listar_servicios") ? "services" : "products");
      Long clientId = invoicing ? clientIdFromEarlierSearch(turns) : null;
      if (found.isEmpty() && r.name().equals("listar_servicios")) {
        // Not a service: the same name may be a product.
        String name = itemName(invoicing ? invoice.group(2) : add.group(1));
        requestTool(sink, "listar_productos", "{\"query\":" + quote(name) + "}");
      } else if (found.isEmpty() || (invoicing && clientId == null)) {
        say(sink, slow, "No encontré ese ítem.");
      } else if (adding) {
        requestTool(
            sink,
            "agregar_item_a_borrador",
            itemArgs(found.get(0).get("id").asLong(), quantityOf(add.group(1)), userText));
      } else {
        requestTool(
            sink,
            "proponer_factura",
            invoiceArgs(
                clientId, found.get(0).get("id").asLong(), quantityOf(invoice.group(2)), userText));
      }
      return;
    }
    switch (r.name()) {
      case "buscar_clientes" -> {
        JsonNode clients = data.get("clients");
        if (clients.isEmpty()) {
          say(sink, slow, "No encontré clientes con ese nombre.");
        } else if (isAppointments(fold(userText))) {
          // «turnos de <nombre>»: second round — appointments of the first client found.
          String date = dateOf(fold(userText), userText);
          requestTool(
              sink,
              "turnos_del_dia",
              "{\"date\":"
                  + quote(date)
                  + ",\"clientId\":"
                  + clients.get(0).get("id").asLong()
                  + "}");
        } else {
          say(
              sink,
              slow,
              "Encontré " + clients.size() + " cliente(s): " + names(clients, "fullName") + ".");
        }
      }
      case "listar_servicios" -> say(sink, slow, listing("Servicios", data.get("services")));
      case "listar_productos" -> say(sink, slow, listing("Productos", data.get("products")));
      case "listar_profesionales" ->
          say(sink, slow, "Profesionales: " + names(data.get("professionals"), "name") + ".");
      case "turnos_del_dia" -> {
        JsonNode rows = data.get("appointments");
        String date = data.get("date").asString();
        if (rows.isEmpty()) {
          say(sink, slow, "No hay turnos para " + date + ".");
        } else {
          StringBuilder sb =
              new StringBuilder("Hay " + rows.size() + " turno(s) para " + date + ":");
          for (JsonNode a : rows) {
            sb.append("\n- ")
                .append(a.get("start").asString())
                .append(" ")
                .append(a.get("clientName").asString())
                .append(" · ")
                .append(a.get("serviceName").asString())
                .append(" · ")
                .append(a.get("professionalName").asString());
          }
          say(sink, slow, sb.toString());
        }
      }
      default -> say(sink, slow, FALLBACK);
    }
  }

  /** Last step of the agenda chains: ask for the free times, or propose the appointment. */
  private void requestAgenda(
      Consumer<ModelEvent> sink,
      List<ChatTurn> turns,
      String userText,
      boolean booking,
      Matcher book,
      Long professionalId,
      long serviceId) {
    String folded = fold(userText);
    String date = dateOf(folded, userText);
    StringBuilder args =
        new StringBuilder("{\"date\":" + quote(date) + ",\"serviceId\":" + serviceId);
    if (professionalId != null) {
      args.append(",\"professionalId\":").append(professionalId);
    }
    if (booking) {
      Long clientId = clientIdFromEarlierSearch(turns);
      args.append(",\"clientId\":").append(clientId);
      args.append(",\"time\":").append(quote(book.group(3)));
      requestTool(sink, "proponer_turno", args.append('}').toString());
    } else {
      if (folded.contains("morning")) {
        args.append(",\"dayPart\":\"MORNING\"");
      } else if (folded.contains("afternoon")) {
        args.append(",\"dayPart\":\"AFTERNOON\"");
      }
      requestTool(sink, "consultar_disponibilidad", args.append('}').toString());
    }
  }

  private Long serviceIdFromEarlierList(List<ChatTurn> turns) {
    for (ChatTurn t : turns) {
      for (ToolResult r : t.toolResults()) {
        if (r.name().equals("listar_servicios")) {
          JsonNode services = objectMapper.readTree(r.content()).path("data").path("services");
          if (!services.isEmpty()) {
            return services.get(0).get("id").asLong();
          }
        }
      }
    }
    return null;
  }

  private static String availabilityText(JsonNode root) {
    if (root.has("error")) {
      return "No pude consultar los horarios (" + root.get("error").asString() + ").";
    }
    JsonNode data = root.get("data");
    StringBuilder sb = new StringBuilder();
    boolean any = false;
    for (JsonNode p : data.get("professionals")) {
      if (!p.get("slots").isEmpty()) {
        any = true;
      }
    }
    if (!any) {
      sb.append("No hay horarios libres el ").append(data.get("date").asString()).append('.');
      if (data.has("suggestedDate")) {
        sb.append(" Probá el ").append(data.get("suggestedDate").asString()).append('.');
      }
      for (JsonNode p : data.get("professionals")) {
        if (!p.get("hasSchedule").asBoolean()) {
          sb.append("\n- ").append(p.get("name").asString()).append(": sin horario cargado");
        }
      }
      return sb.toString();
    }
    sb.append("Horarios libres para ")
        .append(data.get("service").asString())
        .append(" el ")
        .append(data.get("date").asString())
        .append(':');
    for (JsonNode p : data.get("professionals")) {
      if (p.get("slots").isEmpty()) {
        continue;
      }
      List<String> times = new ArrayList<>();
      p.get("slots").forEach(t -> times.add(t.asString()));
      sb.append("\n- ")
          .append(p.get("name").asString())
          .append(": ")
          .append(String.join(", ", times));
    }
    return sb.toString();
  }

  private static String withoutDayPart(String text) {
    return text.trim().replaceAll("(?i)\\s+(?:in the\\s+)?(?:morning|afternoon)\\s*$", "");
  }

  /** What the person asked about a ficha, parsed from the text (tool results are not replayed). */
  private record RecordIntent(
      String client, String op, String rest, boolean isNew, Long recordId, Long appointmentId) {}

  private static RecordIntent recordIntent(String text) {
    Matcher m = RECORD.matcher(text);
    if (!m.matches()) {
      return null;
    }
    String body = m.group(1);
    Long recordId = null;
    Long appointmentId = null;
    Matcher rec = REC_ID.matcher(body);
    if (rec.find()) {
      recordId = Long.valueOf(rec.group(1));
      body = rec.replaceAll("");
    }
    Matcher apt = APT_ID.matcher(body);
    if (apt.find()) {
      appointmentId = Long.valueOf(apt.group(1));
      body = apt.replaceAll("");
    }
    boolean isNew = NEW_FLAG.matcher(body).find();
    body = NEW_FLAG.matcher(body).replaceAll("").replaceAll("\\s+", " ").trim();
    Matcher op = RECORD_OP.matcher(body);
    if (op.matches()) {
      String kind =
          switch (op.group(2).toLowerCase()) {
            case "add", "agrega" -> "add";
            case "remove", "quita" -> "remove";
            default -> "set";
          };
      return new RecordIntent(
          op.group(1).trim(), kind, op.group(3).trim(), isNew, recordId, appointmentId);
    }
    boolean flags = isNew || recordId != null || appointmentId != null;
    return new RecordIntent(body, flags ? "open" : "read", "", isNew, recordId, appointmentId);
  }

  private void answerRecord(
      RecordIntent ri,
      List<ChatTurn> turns,
      ToolResult r,
      JsonNode root,
      boolean slow,
      Consumer<ModelEvent> sink) {
    if (r.name().equals("proponer_ficha")) {
      say(
          sink,
          slow,
          root.has("error")
              ? fichaError(root.get("error").asString())
              : "Preparé la ficha de "
                  + root.get("data").get("client").asString()
                  + " para que la revises. Guardala con el botón de la tarjeta.");
      return;
    }
    if (root.has("error")) {
      say(sink, slow, "No pude consultar ese dato.");
      return;
    }
    JsonNode data = root.get("data");
    switch (r.name()) {
      case "buscar_clientes" -> {
        JsonNode clients = data.get("clients");
        if (clients.isEmpty()) {
          say(sink, slow, "No encontré clientes con ese nombre.");
          return;
        }
        long clientId = clients.get(0).get("id").asLong();
        switch (ri.op()) {
          case "read" -> requestTool(sink, "ver_ficha_abierta", "{\"clientId\":" + clientId + "}");
          case "add" ->
              requestTool(
                  sink, "listar_servicios", "{\"query\":" + quote(itemName(ri.rest())) + "}");
          case "remove" -> {
            Matcher n = LEADING_NUMBER.matcher(ri.rest());
            if (n.find()) {
              requestTool(
                  sink,
                  "proponer_ficha",
                  recordArgs(clientId, ri, "\"quitar\":[" + n.group(1) + "]"));
            } else {
              say(sink, slow, FALLBACK);
            }
          }
          case "set" -> {
            Matcher pro = SET_PROFESSIONAL.matcher(ri.rest());
            Matcher qty = SET_QUANTITY.matcher(ri.rest());
            if (pro.matches()) {
              requestTool(sink, "listar_profesionales", "{}");
            } else if (qty.matches()) {
              requestTool(
                  sink,
                  "proponer_ficha",
                  recordArgs(
                      clientId,
                      ri,
                      "\"cambiar\":[{\"position\":"
                          + qty.group(1)
                          + ",\"quantity\":"
                          + qty.group(2)
                          + "}]"));
            } else {
              say(sink, slow, FALLBACK);
            }
          }
          default -> requestTool(sink, "proponer_ficha", recordArgs(clientId, ri, null));
        }
      }
      case "listar_servicios", "listar_productos" -> {
        boolean services = r.name().equals("listar_servicios");
        JsonNode found = data.get(services ? "services" : "products");
        Long clientId = clientIdFromEarlierSearch(turns);
        if (found.isEmpty() && services) {
          requestTool(sink, "listar_productos", "{\"query\":" + quote(itemName(ri.rest())) + "}");
        } else if (found.isEmpty() || clientId == null) {
          say(sink, slow, "No encontré ese ítem.");
        } else {
          StringBuilder item =
              new StringBuilder("{\"id\":" + found.get(0).get("id").asLong())
                  .append(",\"quantity\":")
                  .append(quantityOf(ri.rest()));
          Matcher price = PRICE.matcher(withoutTrailingPayment(ri.rest()));
          if (price.find()) {
            item.append(",\"unitPrice\":").append(price.group(1).replace(".", ""));
          }
          requestTool(
              sink,
              "proponer_ficha",
              recordArgs(clientId, ri, "\"agregar\":[" + item.append('}') + "]"));
        }
      }
      case "listar_profesionales" -> {
        Matcher pro = SET_PROFESSIONAL.matcher(ri.rest());
        Long clientId = clientIdFromEarlierSearch(turns);
        Long proId = null;
        if (pro.matches()) {
          for (JsonNode p : data.get("professionals")) {
            if (fold(p.get("name").asString()).contains(fold(pro.group(2).trim()))) {
              proId = p.get("id").asLong();
              break;
            }
          }
        }
        if (proId == null || clientId == null) {
          say(sink, slow, "No encontré a ese profesional.");
        } else {
          requestTool(
              sink,
              "proponer_ficha",
              recordArgs(
                  clientId,
                  ri,
                  "\"cambiar\":[{\"position\":"
                      + pro.group(1)
                      + ",\"professionalId\":"
                      + proId
                      + "}]"));
        }
      }
      case "ver_ficha_abierta" -> say(sink, slow, recordText(data));
      default -> say(sink, slow, FALLBACK);
    }
  }

  private static String recordArgs(long clientId, RecordIntent ri, String extra) {
    StringBuilder sb = new StringBuilder("{\"clientId\":" + clientId);
    if (ri.isNew()) {
      sb.append(",\"newRecord\":true");
    }
    if (ri.recordId() != null) {
      sb.append(",\"recordId\":").append(ri.recordId());
    }
    if (ri.appointmentId() != null) {
      sb.append(",\"appointmentId\":").append(ri.appointmentId());
    }
    if (extra != null) {
      sb.append(',').append(extra);
    }
    return sb.append('}').toString();
  }

  private static String fichaError(String code) {
    return switch (code) {
      case "MULTIPLE_RECORDS" -> "Tiene varias fichas abiertas. ¿Cuál querés cambiar?";
      case "STALE_RECORD" ->
          "Tiene una ficha abierta de un día anterior. ¿La edito o abro una nueva para hoy?";
      case "MULTIPLE_APPOINTMENTS" -> "Tiene varios turnos hoy. ¿A cuál le ligo la ficha?";
      case "NO_APPOINTMENT_TODAY" ->
          "Solo podés abrir una ficha desde un turno propio de hoy, y no hay ninguno.";
      case "PRICE_NOT_ALLOWED" -> "No podés fijar precios: eso lo hace administración.";
      case "NOTHING_TO_SAVE" -> "La ficha no tendría ninguna línea. Decime qué agregar.";
      case "INVALID_LINE_POSITION" -> "Esa línea no existe en la ficha.";
      case "FICHA_DRAFT_PENDING" -> "Hay una ficha sin guardar: guardala o descartala primero.";
      default -> "No pude preparar la ficha (" + code + ").";
    };
  }

  /** The ficha as plain text: numbered lines, with money only when the tool sent it. */
  private static String recordText(JsonNode data) {
    JsonNode records = data.path("records");
    StringBuilder sb = new StringBuilder();
    if (records.isEmpty()) {
      sb.append(data.path("clientName").asString()).append(" no tiene fichas abiertas.");
    }
    for (JsonNode rec : records) {
      if (!sb.isEmpty()) {
        sb.append("\n");
      }
      sb.append(data.path("pending").asBoolean(false) ? "Ficha (borrador):" : "Ficha abierta:");
      for (JsonNode l : rec.path("lines")) {
        sb.append("\n")
            .append(l.path("position").asInt())
            .append(". ")
            .append(l.path("name").asString())
            .append(" ×")
            .append(l.path("quantity").asInt());
        if (!l.path("professionalName").isNull() && !l.path("professionalName").isMissingNode()) {
          sb.append(" · ").append(l.path("professionalName").asString());
        }
        if (l.has("price")) {
          sb.append(" — ").append(l.get("price").asString());
        }
      }
      if (rec.has("total")) {
        sb.append("\nTotal: ").append(rec.get("total").asString());
      }
    }
    JsonNode turnos = data.path("appointmentsToday");
    if (!turnos.isEmpty()) {
      sb.append("\nTurnos de hoy:");
      for (JsonNode t : turnos) {
        sb.append(" ")
            .append(t.path("start").asString())
            .append(" ")
            .append(t.path("serviceName").asString());
      }
    }
    return sb.toString();
  }

  private void answerProposal(String tool, JsonNode root, boolean slow, Consumer<ModelEvent> sink) {
    if (root.has("error")) {
      String code = root.get("error").asString();
      say(
          sink,
          slow,
          switch (code) {
            case "MULTIPLE_APPOINTMENTS" ->
                "El cliente tiene varios turnos hoy. ¿Cuál querés facturar?";
            case "NOTHING_TO_INVOICE" -> "No encontré nada para facturar. ¿Qué servicios cobro?";
            case "CLIENT_REQUIRES_MANUAL_INVOICE" -> "Esa factura se hace desde Facturación.";
            case "FORBIDDEN" -> "Facturar es solo para administración.";
            case "INVALID_PRICE" ->
                "Ese precio no es válido: tiene que ser un monto entero mayor a cero.";
            case "PRICE_SERVICE_NOT_IN_INVOICE" -> "Ese servicio no está en la factura.";
            case "SLOT_TAKEN" -> "Ese horario está ocupado. Elegí otro de los botones.";
            case "START_IN_PAST" -> "Ese horario ya pasó.";
            case "APPOINTMENT_NOT_OWNED_BY_PROFESSIONAL" ->
                "Solo podés agendar turnos para vos misma.";
            case "FICHA_DRAFT_PENDING" ->
                "Hay una ficha sin guardar de ese cliente: guardala o descartala antes de facturar.";
            case "NO_ACTIVE_DRAFT" -> "No hay ningún borrador para descartar.";
            case "NO_ACTIVE_INVOICE_DRAFT" ->
                "No hay una factura en borrador. Decime a qué cliente se la preparo.";
            default -> "No pude preparar el borrador (" + code + ").";
          });
      return;
    }
    if (tool.equals("proponer_turno")) {
      JsonNode d = root.get("data");
      say(
          sink,
          slow,
          "Preparé el borrador del turno de "
              + d.get("service").asString()
              + " para "
              + d.get("client").asString()
              + " el "
              + d.get("date").asString()
              + " a las "
              + d.get("time").asString()
              + ". Revisalo y confirmalo con el botón de la tarjeta.");
      return;
    }
    if (tool.equals("descartar_borrador")) {
      say(sink, slow, "Listo, descarté el borrador.");
      return;
    }
    say(
        sink,
        slow,
        (tool.equals("agregar_item_a_borrador")
                ? "Actualicé el borrador de factura para "
                : "Preparé el borrador de factura para ")
            + root.get("data").get("client").asString()
            + ". Revisalo y confirmalo con el botón de la tarjeta.");
  }

  /**
   * «Corte cash» → «Corte»: a payment word at the end is the payment method, not part of a name.
   */
  private static String withoutPayment(String text) {
    String out = text.trim();
    // Trailing «at 45000» (a price the person said) and a payment word, in either order.
    String before;
    do {
      before = out;
      out = out.replaceAll("(?i)\\s+(?:cash|efectivo|transfer\\w*)\\s*$", "");
      out = PRICE.matcher(out).replaceFirst("");
    } while (!out.equals(before));
    return out;
  }

  /**
   * A price said at the end of the request: «… at 45000», «… a 45.000», «… @45000» (not
   * «price»/«precio»: they appear in service names).
   */
  private static final Pattern PRICE = Pattern.compile("(?i)\\s+(?:at|a|@)\\s*(\\d[\\d.]*)\\s*$");

  private static String withoutTrailingPayment(String text) {
    return text.trim().replaceAll("(?i)\\s+(?:cash|efectivo|transfer\\w*)\\s*$", "");
  }

  private static String invoiceArgs(long clientId, Long serviceId, int quantity, String userText) {
    String folded = fold(userText);
    StringBuilder sb = new StringBuilder("{\"clientId\":" + clientId);
    if (serviceId != null) {
      sb.append(",\"items\":[{\"id\":")
          .append(serviceId)
          .append(",\"quantity\":")
          .append(quantity)
          .append("}]")
          .append(priceJson(serviceId, userText));
    }
    if (folded.contains("cash") || folded.contains("efectivo")) {
      sb.append(",\"paymentMethod\":\"CASH\"");
    } else if (folded.contains("transfer")) {
      sb.append(",\"paymentMethod\":\"TRANSFER\"");
    }
    return sb.append('}').toString();
  }

  /** Arguments of {@code agregar_item_a_borrador}. */
  private static String itemArgs(long itemId, int quantity, String userText) {
    return "{\"items\":[{\"id\":"
        + itemId
        + ",\"quantity\":"
        + quantity
        + "}]"
        + priceJson(itemId, userText)
        + "}";
  }

  /** «, "prices": [...]» when the request ends with a price said by the person, else empty. */
  private static String priceJson(long itemId, String userText) {
    Matcher price = PRICE.matcher(withoutTrailingPayment(userText));
    return price.find()
        ? ",\"prices\":[{\"serviceId\":"
            + itemId
            + ",\"unitPrice\":"
            + price.group(1).replace(".", "")
            + "}]"
        : "";
  }

  /** «Shampoo x2 at 20000 cash» → «Shampoo»: what to look up in the catalog. */
  private static String itemName(String text) {
    return QUANTITY.matcher(withoutPayment(text)).replaceFirst("").trim();
  }

  /** «Shampoo x2 at 20000» → 2 (1 when no quantity was said). */
  private static int quantityOf(String text) {
    Matcher q = QUANTITY.matcher(withoutPayment(text == null ? "" : text));
    return q.find() ? Integer.parseInt(q.group(1)) : 1;
  }

  /**
   * The client found by the earlier search of this same request (tool results are not replayed).
   */
  private Long clientIdFromEarlierSearch(List<ChatTurn> turns) {
    for (ChatTurn t : turns) {
      for (ToolResult r : t.toolResults()) {
        if (r.name().equals("buscar_clientes")) {
          JsonNode clients = objectMapper.readTree(r.content()).path("data").path("clients");
          if (!clients.isEmpty()) {
            return clients.get(0).get("id").asLong();
          }
        }
      }
    }
    return null;
  }

  /** Fixed format, same as the system prompt asks of the real model: «- Nombre — Gs. 50.000». */
  private static String listing(String title, JsonNode items) {
    StringBuilder sb = new StringBuilder(title + ":");
    for (JsonNode s : items) {
      sb.append("\n- ")
          .append(s.get("name").asString())
          .append(" — ")
          .append(s.get("price").asString());
    }
    return sb.toString();
  }

  private static String dateOf(String folded, String original) {
    Matcher iso = ISO_DATE.matcher(original);
    if (iso.find()) {
      return iso.group();
    }
    return folded.contains("manana") || folded.contains("tomorrow") ? "mañana" : "hoy";
  }

  private static boolean isSlow(String folded) {
    return folded.contains("slowly") || folded.contains("despacio");
  }

  private static void pause() {
    try {
      Thread.sleep(SLOW_CHUNK_PAUSE_MS);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
  }

  private static boolean isAppointments(String folded) {
    return folded.contains("turnos") || folded.contains("appointments");
  }

  private static String names(JsonNode rows, String field) {
    List<String> out = new ArrayList<>();
    rows.forEach(n -> out.add(n.get(field).asString()));
    return String.join(", ", out);
  }

  private static String lastUserText(List<ChatTurn> turns) {
    for (int i = turns.size() - 1; i >= 0; i--) {
      if (turns.get(i).kind() == Kind.USER) {
        return turns.get(i).text();
      }
    }
    return "";
  }

  private static void requestTool(Consumer<ModelEvent> sink, String tool, String argsJson) {
    sink.accept(new ModelEvent.ToolCalls(List.of(new ToolCall("call_" + tool, tool, argsJson))));
    sink.accept(new ModelEvent.Completed(new Usage(50, 8)));
  }

  /** Streams the text in small chunks, as a real model would, to exercise the SSE parser. */
  private static void say(Consumer<ModelEvent> sink, boolean slow, String text) {
    for (int i = 0; i < text.length(); i += CHUNK) {
      if (slow) {
        pause();
      }
      sink.accept(new ModelEvent.TextDelta(text.substring(i, Math.min(text.length(), i + CHUNK))));
    }
    sink.accept(new ModelEvent.Completed(new Usage(60, Math.max(1, text.length() / 4))));
  }

  private static String fold(String s) {
    return Normalizer.normalize(s.toLowerCase(Locale.ROOT), Normalizer.Form.NFD)
        .replaceAll("\\p{M}", "");
  }

  private String quote(String s) {
    return objectMapper.writeValueAsString(s);
  }
}
