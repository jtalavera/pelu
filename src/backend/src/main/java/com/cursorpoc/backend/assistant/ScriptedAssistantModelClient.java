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

  private static final Pattern DISCARD =
      Pattern.compile("(?i)\\b(?:discard|descart\\w*)\\b.*\\b(?:draft|borrador)\\b");

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
    if (DISCARD.matcher(userText).find()) {
      requestTool(sink, "descartar_borrador", "{}");
    } else if (SLOT_CHIP.matcher(userText).find()) {
      say(sink, slow, "¿Para qué cliente querés agendar ese horario?");
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
    Matcher invoice = INVOICE.matcher(userText.trim());
    boolean invoicing = invoice.find();
    if (r.name().equals("proponer_factura")
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
      String service = invoice.group(2) == null ? null : withoutPayment(invoice.group(2));
      if (service != null && !service.isBlank()) {
        requestTool(sink, "listar_servicios", "{\"query\":" + quote(service) + "}");
      } else {
        requestTool(sink, "proponer_factura", invoiceArgs(clientId, null, userText));
      }
      return;
    }
    if (invoicing && r.name().equals("listar_servicios")) {
      JsonNode services = data.get("services");
      Long clientId = clientIdFromEarlierSearch(turns);
      if (services.isEmpty() || clientId == null) {
        say(sink, slow, "No encontré ese servicio.");
      } else {
        requestTool(
            sink,
            "proponer_factura",
            invoiceArgs(clientId, services.get(0).get("id").asLong(), userText));
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
      case "listar_servicios" -> say(sink, slow, servicesListing(data.get("services")));
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
            case "NO_ACTIVE_DRAFT" -> "No hay ningún borrador para descartar.";
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
        "Preparé el borrador de factura para "
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

  private static String invoiceArgs(long clientId, Long serviceId, String userText) {
    String folded = fold(userText);
    StringBuilder sb = new StringBuilder("{\"clientId\":" + clientId);
    if (serviceId != null) {
      sb.append(",\"serviceIds\":[").append(serviceId).append(']');
    }
    if (serviceId != null) {
      Matcher price = PRICE.matcher(withoutTrailingPayment(userText));
      if (price.find()) {
        sb.append(",\"prices\":[{\"serviceId\":")
            .append(serviceId)
            .append(",\"unitPrice\":")
            .append(price.group(1).replace(".", ""))
            .append("}]");
      }
    }
    if (folded.contains("cash") || folded.contains("efectivo")) {
      sb.append(",\"paymentMethod\":\"CASH\"");
    } else if (folded.contains("transfer")) {
      sb.append(",\"paymentMethod\":\"TRANSFER\"");
    }
    return sb.append('}').toString();
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
  private static String servicesListing(JsonNode services) {
    StringBuilder sb = new StringBuilder("Servicios:");
    for (JsonNode s : services) {
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
