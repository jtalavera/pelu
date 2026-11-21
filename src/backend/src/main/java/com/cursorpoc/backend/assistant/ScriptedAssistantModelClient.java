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
      answerFromToolResults(last, userText, slow, sink);
      return;
    }
    String folded = fold(userText);
    if (folded.contains("falla modelo") || folded.contains("model fails")) {
      throw new AssistantModelException("scripted failure");
    }
    Matcher of = APPOINTMENTS_OF.matcher(userText.trim());
    if (isAppointments(folded) && of.find()) {
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
      ChatTurn results, String userText, boolean slow, Consumer<ModelEvent> sink) {
    ToolResult r = results.toolResults().get(0);
    JsonNode root = objectMapper.readTree(r.content());
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
