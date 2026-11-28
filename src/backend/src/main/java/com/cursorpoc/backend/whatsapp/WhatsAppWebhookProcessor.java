package com.cursorpoc.backend.whatsapp;

import com.cursorpoc.backend.domain.WhatsAppProcessedEvent;
import com.cursorpoc.backend.repository.WhatsAppProcessedEventRepository;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Handles an already-authenticated (signed) Meta notification. In C0 only the template and quality
 * notices (HU-WAP-02, criterio 3) are acted on; delivery statuses (HU-WAP-07) and the messages
 * clients write (HU-WAP-06) go to their own services. Message contents are never logged (RT-13),
 * and nothing thrown here may turn into a non-200 for Meta.
 */
@Service
public class WhatsAppWebhookProcessor {

  private static final Logger log = LoggerFactory.getLogger(WhatsAppWebhookProcessor.class);

  private final ObjectMapper objectMapper;
  private final WhatsAppTemplateStatusService templateStatus;
  private final PlatformAlertService alerts;
  private final WhatsAppDeliveryService delivery;
  private final WhatsAppFallbackService fallback;
  private final WhatsAppInboundService inbound;
  private final WhatsAppProcessedEventRepository processedEvents;

  public WhatsAppWebhookProcessor(
      ObjectMapper objectMapper,
      WhatsAppTemplateStatusService templateStatus,
      PlatformAlertService alerts,
      WhatsAppDeliveryService delivery,
      WhatsAppFallbackService fallback,
      WhatsAppInboundService inbound,
      WhatsAppProcessedEventRepository processedEvents) {
    this.inbound = inbound;
    this.processedEvents = processedEvents;
    this.objectMapper = objectMapper;
    this.templateStatus = templateStatus;
    this.alerts = alerts;
    this.delivery = delivery;
    this.fallback = fallback;
  }

  /** Delivery statuses of messages we sent (HU-WAP-07). */
  private void processStatuses(JsonNode value) {
    for (JsonNode st : value.path("statuses")) {
      try {
        String wamid = st.path("id").asString();
        String status = st.path("status").asString();
        Integer errorCode = null;
        JsonNode errors = st.path("errors");
        if (errors.isArray() && errors.size() > 0 && errors.get(0).path("code").isNumber()) {
          errorCode = errors.get(0).path("code").asInt();
        }
        Instant at = null;
        String ts = st.path("timestamp").asString();
        if (ts != null && ts.matches("\\d{9,12}")) {
          at = Instant.ofEpochSecond(Long.parseLong(ts));
        }
        WhatsAppDeliveryService.Outcome o = delivery.applyStatus(wamid, status, errorCode, at);
        if (o.tenantId() != null) {
          log.info("WHATSAPP delivery status tenantId={} status={}", o.tenantId(), status);
        }
        if (o.failedMessageId() != null) {
          fallback.sendIfEligible(o.failedMessageId());
        }
      } catch (RuntimeException ex) {
        log.error("WHATSAPP delivery status failed error={}", ex.toString());
      }
    }
  }

  /**
   * Messages the clients wrote to the shared number (HU-WAP-06). Each one is handled once: its id
   * is stored first, so Meta re-sending the notification does nothing. If handling fails the id
   * stays stored (Meta must not retry forever) and a platform alert names the failure, never the
   * content.
   */
  private void processMessages(JsonNode value) {
    for (JsonNode msg : value.path("messages")) {
      String id = msg.path("id").asString();
      try {
        if (id == null || id.isBlank()) {
          continue;
        }
        String eventId = "in:" + id;
        if (processedEvents.existsById(eventId)) {
          continue; // Meta re-sent it
        }
        try {
          processedEvents.saveAndFlush(new WhatsAppProcessedEvent(eventId, Instant.now()));
        } catch (DataIntegrityViolationException dup) {
          continue; // already handled
        }
        inbound.handle(toInbound(id, msg));
      } catch (RuntimeException ex) {
        log.error("WHATSAPP inbound message failed error={}", ex.toString());
        try {
          alerts.raise(
              "WHATSAPP_INBOUND_FAILED", "inbound", "A client message could not be handled");
        } catch (RuntimeException ignored) {
          // Alerting must never turn into a non-200 for Meta.
        }
      }
    }
  }

  static WhatsAppInboundService.Inbound toInbound(String id, JsonNode msg) {
    String from = "+" + msg.path("from").asString();
    String type = msg.path("type").asString();
    if ("text".equals(type)) {
      return new WhatsAppInboundService.Inbound(
          id,
          from,
          WhatsAppInboundService.Kind.TEXT,
          msg.path("text").path("body").asString(),
          null);
    }
    if ("button".equals(type)) { // a quick-reply button of a template
      return new WhatsAppInboundService.Inbound(
          id,
          from,
          WhatsAppInboundService.Kind.BUTTON,
          null,
          msg.path("button").path("payload").asString());
    }
    if ("interactive".equals(type)) { // a reply button of a free-form message
      return new WhatsAppInboundService.Inbound(
          id,
          from,
          WhatsAppInboundService.Kind.BUTTON,
          null,
          msg.path("interactive").path("button_reply").path("id").asString());
    }
    return new WhatsAppInboundService.Inbound(
        id, from, WhatsAppInboundService.Kind.OTHER, null, null); // audio, image, location…
  }

  public void process(byte[] rawBody) {
    try {
      JsonNode root = objectMapper.readTree(rawBody);
      for (JsonNode entry : root.path("entry")) {
        for (JsonNode change : entry.path("changes")) {
          String field = change.path("field").asString();
          JsonNode value = change.path("value");
          switch (field) {
            case "message_template_status_update" ->
                templateStatus.applyWebhookEvent(
                    value.path("message_template_name").asString(),
                    value.path("message_template_language").asString(),
                    value.path("event").asString(),
                    value.path("reason").asString());
            case "message_template_quality_update" -> {
              String name = value.path("message_template_name").asString();
              String score = value.path("new_quality_score").asString();
              log.info("WHATSAPP template quality update template={} score={}", name, score);
              if ("RED".equalsIgnoreCase(score) || "LOW".equalsIgnoreCase(score)) {
                alerts.raise("WHATSAPP_TEMPLATE_QUALITY_LOW", name, "Quality score: " + score);
              }
            }
            case "messages" -> {
              processStatuses(value);
              processMessages(value);
            }
            default -> log.info("WHATSAPP webhook field ignored field={}", field);
          }
        }
      }
    } catch (RuntimeException ex) {
      log.error("WHATSAPP webhook processing failed error={}", ex.toString());
    }
  }
}
