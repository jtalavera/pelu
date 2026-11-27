package com.cursorpoc.backend.whatsapp;

import com.cursorpoc.backend.config.FrontendUrl;
import com.cursorpoc.backend.domain.WhatsAppMessage;
import java.util.List;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

/**
 * HU-WAP-07 (criterio 5): when a booking notice or a reminder cannot be delivered over WhatsApp
 * (definitive failure, "not delivered", unreachable number, unusable template), ONE email with the
 * same content goes out if the message has an address. The send is claimed at most once in the
 * database; if the email itself fails the claim is released and the sweep tries again. The
 * verification code never falls back on its own: the client chooses (RSV-05).
 */
@Service
public class WhatsAppFallbackService {

  private static final Logger log = LoggerFactory.getLogger(WhatsAppFallbackService.class);

  /** Purposes that have a fallback (the code of verification has none). */
  static final Set<String> PURPOSES = Set.of("BOOKING", "REMINDER");

  private final WhatsAppMessageStore store;
  private final FallbackEmailSender sender;
  private final ObjectMapper objectMapper;
  private final String frontendUrl;

  public WhatsAppFallbackService(
      WhatsAppMessageStore store,
      FallbackEmailSender sender,
      ObjectMapper objectMapper,
      @Value(FrontendUrl.PRIMARY_EXPR) String frontendUrl) {
    this.store = store;
    this.sender = sender;
    this.objectMapper = objectMapper;
    this.frontendUrl = frontendUrl == null ? "" : frontendUrl.replaceAll("/+$", "");
  }

  /** Sends the fallback email of a FAILED message if it is eligible. Never throws. */
  public boolean sendIfEligible(long messageId) {
    try {
      WhatsAppMessage m = store.get(messageId);
      if (!PURPOSES.contains(m.getPurpose())
          || !WhatsAppMessage.FAILED.equals(m.getStatus())
          || m.getFallbackEmail() == null
          || m.getFallbackEmailSentAt() != null) {
        return false;
      }
      WhatsAppTemplate template = WhatsAppTemplate.byName(m.getTemplate());
      if (template == null || template.bodyText() == null) {
        return false;
      }
      if (!store.claimFallback(messageId)) {
        return false; // somebody else already sent it
      }
      try {
        WhatsAppOutbox.StoredPayload p =
            objectMapper.readValue(m.getPayload(), WhatsAppOutbox.StoredPayload.class);
        sender.send(m.getFallbackEmail(), subject(template), compose(template, p));
        log.info(
            "WHATSAPP fallback email sent tenantId={} messageId={} template={}",
            m.getTenantId(),
            messageId,
            m.getTemplate());
        return true;
      } catch (RuntimeException ex) {
        store.releaseFallback(messageId);
        log.error(
            "WHATSAPP fallback email failed tenantId={} messageId={} error={}",
            m.getTenantId(),
            messageId,
            ex.toString());
        return false;
      }
    } catch (RuntimeException ex) {
      log.error("WHATSAPP fallback error messageId={} error={}", messageId, ex.toString());
      return false;
    }
  }

  static String subject(WhatsAppTemplate t) {
    return switch (t) {
      case TURNO_CONFIRMADO -> "Tu turno está confirmado";
      case TURNO_PENDIENTE -> "Recibimos tu solicitud de turno";
      case TURNO_NO_DISPONIBLE -> "No pudimos confirmar tu turno";
      case PROPUESTA_HORARIO -> "Te proponemos otro horario";
      case RECORDATORIO_TURNO -> "Recordatorio de tu turno";
      case TURNO_CANCELADO -> "Tu turno fue cancelado";
      case CODIGO_VERIFICACION -> "Código de verificación";
    };
  }

  /** The WhatsApp body text with its variables, plus the link of each URL button. */
  String compose(WhatsAppTemplate template, WhatsAppOutbox.StoredPayload p) {
    String text = template.bodyText();
    List<String> vars = p.bodyParameters();
    for (int i = 0; i < vars.size(); i++) {
      text = text.replace("{{" + (i + 1) + "}}", vars.get(i));
    }
    // The email has no buttons: the sentence that points at "the button below" is rewritten.
    text = text.replace(" con el botón de abajo", " con el enlace de abajo");
    StringBuilder sb = new StringBuilder(text);
    for (WhatsAppButton b : p.buttons()) {
      if (b.kind() == WhatsAppButton.Kind.URL && b.index() < template.buttons().size()) {
        sb.append("\n\n")
            .append(template.buttons().get(b.index()).text())
            .append(": ")
            .append(frontendUrl)
            .append("/r/")
            .append(b.value());
      }
    }
    sb.append("\n\nTe escribimos por email porque no pudimos enviarte este aviso por WhatsApp.");
    return sb.toString();
  }
}
