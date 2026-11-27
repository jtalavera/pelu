package com.cursorpoc.backend.whatsapp;

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

  public WhatsAppWebhookProcessor(
      ObjectMapper objectMapper,
      WhatsAppTemplateStatusService templateStatus,
      PlatformAlertService alerts) {
    this.objectMapper = objectMapper;
    this.templateStatus = templateStatus;
    this.alerts = alerts;
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
            default -> log.info("WHATSAPP webhook field ignored field={}", field);
          }
        }
      }
    } catch (RuntimeException ex) {
      log.error("WHATSAPP webhook processing failed error={}", ex.toString());
    }
  }
}
