package com.cursorpoc.backend.whatsapp;

import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Handles an already-authenticated (signed) Meta notification. In C0 only the template and quality
 * notices (HU-WAP-02, criterio 3) are acted on; incoming messages and delivery statuses are ignored
 * until HU-WAP-07 / HU-WAP-06. Message contents are never logged (RT-13), and nothing thrown here
 * may turn into a non-200 for Meta.
 */
@Service
public class WhatsAppWebhookProcessor {

  private static final Logger log = LoggerFactory.getLogger(WhatsAppWebhookProcessor.class);

  private final ObjectMapper objectMapper;
  private final WhatsAppTemplateStatusService templateStatus;
  private final PlatformAlertService alerts;
  private final WhatsAppDeliveryService delivery;
  private final WhatsAppFallbackService fallback;

  public WhatsAppWebhookProcessor(
      ObjectMapper objectMapper,
      WhatsAppTemplateStatusService templateStatus,
      PlatformAlertService alerts,
      WhatsAppDeliveryService delivery,
      WhatsAppFallbackService fallback) {
    this.objectMapper = objectMapper;
    this.templateStatus = templateStatus;
    this.alerts = alerts;
    this.delivery = delivery;
    this.fallback = fallback;
  }

  /**
   * Delivery statuses of messages we sent (HU-WAP-07). Incoming messages from clients are handled
   * from HU-WAP-06 on; until then they are ignored.
   */
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
            case "messages" -> processStatuses(value);
            default -> log.info("WHATSAPP webhook field ignored field={}", field);
          }
        }
      }
    } catch (RuntimeException ex) {
      log.error("WHATSAPP webhook processing failed error={}", ex.toString());
    }
  }
}
