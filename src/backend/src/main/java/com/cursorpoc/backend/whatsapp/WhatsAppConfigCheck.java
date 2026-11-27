package com.cursorpoc.backend.whatsapp;

import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * HU-WAP-01 (criterio 6): with {@code WHATSAPP_ENABLED=true} but a mandatory value missing, the
 * channel is treated as OFF and that is made loud — an ERROR in the log and an alert for platform
 * administrators — instead of failing silently. Only names are reported, never values.
 */
@Component
public class WhatsAppConfigCheck {

  private static final Logger log = LoggerFactory.getLogger(WhatsAppConfigCheck.class);

  static final String ALERT_CATEGORY = "WHATSAPP_CONFIG_INCOMPLETE";

  private final WhatsAppSettings settings;
  private final PlatformAlertService alerts;

  public WhatsAppConfigCheck(WhatsAppSettings settings, PlatformAlertService alerts) {
    this.settings = settings;
    this.alerts = alerts;
  }

  @EventListener(ApplicationReadyEvent.class)
  public void check() {
    if (settings.isEnabled() && settings.isFake()) {
      log.warn("WHATSAPP provider=fake is active: no message leaves this process");
    }
    List<String> problems = settings.configurationProblems();
    if (!problems.isEmpty()) {
      log.error(
          "WHATSAPP is enabled but not configured; the channel stays OFF. Missing: {}", problems);
      alerts.raise(ALERT_CATEGORY, "whatsapp", "Missing: " + String.join(", ", problems));
    }
  }
}
