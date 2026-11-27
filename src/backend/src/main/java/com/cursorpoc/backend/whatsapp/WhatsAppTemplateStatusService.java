package com.cursorpoc.backend.whatsapp;

import com.cursorpoc.backend.domain.WhatsAppTemplateStatus;
import com.cursorpoc.backend.repository.WhatsAppTemplateStatusRepository;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * HU-WAP-02: what Meta says about each catalog template. A template that is not APPROVED is never
 * used (RT-12): the message goes to the email fallback. A rejection, pause or disappearance raises
 * a platform alert; recovery closes it.
 */
@Service
public class WhatsAppTemplateStatusService {

  private static final Logger log = LoggerFactory.getLogger(WhatsAppTemplateStatusService.class);

  public static final String APPROVED = "APPROVED";
  public static final String MISSING = "MISSING";
  private static final Set<String> BAD = Set.of("REJECTED", "PAUSED", "DISABLED", MISSING);
  static final String ALERT_PREFIX = "WHATSAPP_TEMPLATE_";

  private final WhatsAppGateway gateway;
  private final WhatsAppTemplateStatusRepository repository;
  private final PlatformAlertService alerts;
  private final TransactionTemplate tx;

  public WhatsAppTemplateStatusService(
      WhatsAppGateway gateway,
      WhatsAppTemplateStatusRepository repository,
      PlatformAlertService alerts,
      PlatformTransactionManager transactionManager) {
    this.gateway = gateway;
    this.repository = repository;
    this.alerts = alerts;
    this.tx = new TransactionTemplate(transactionManager);
  }

  /** Asks Meta for the current statuses and stores them. Throws if Meta cannot be reached. */
  public List<WhatsAppTemplateStatus> refresh() {
    List<WhatsAppRemoteTemplate> remote = gateway.listTemplates();
    tx.executeWithoutResult(
        s -> {
          for (WhatsAppTemplate t : WhatsAppTemplate.values()) {
            WhatsAppRemoteTemplate match =
                remote.stream()
                    .filter(
                        r ->
                            t.templateName().equals(r.name())
                                && WhatsAppTemplate.LANGUAGE.equals(r.language()))
                    .findFirst()
                    .orElse(null);
            if (match == null) {
              upsert(t.templateName(), MISSING, t.category().name(), "NOT_SUBMITTED");
            } else {
              upsert(
                  t.templateName(),
                  match.status().toUpperCase(Locale.ROOT),
                  match.category(),
                  match.reason());
            }
          }
        });
    return all();
  }

  /** A status change pushed by Meta's webhook ({@code message_template_status_update}). */
  public void applyWebhookEvent(String templateName, String language, String event, String reason) {
    if (WhatsAppTemplate.byName(templateName) == null || event == null) {
      return;
    }
    String status =
        switch (event.toUpperCase(Locale.ROOT)) {
          case "APPROVED", "REINSTATED" -> APPROVED;
          case "PENDING" -> "PENDING";
          case "REJECTED" -> "REJECTED";
          case "PAUSED" -> "PAUSED";
          case "DISABLED" -> "DISABLED";
          default -> null;
        };
    if ("FLAGGED".equalsIgnoreCase(event)) {
      alerts.raise(ALERT_PREFIX + "FLAGGED", templateName, "Template flagged by Meta");
      return;
    }
    if (status == null) {
      return;
    }
    tx.executeWithoutResult(
        s ->
            upsert(
                templateName,
                status,
                WhatsAppTemplate.byName(templateName).category().name(),
                reason));
  }

  /** True only when Meta last reported the template as APPROVED. */
  public boolean isUsable(String templateName, String language) {
    WhatsAppTemplateStatus row =
        repository.findByTemplateNameAndLanguage(templateName, language).orElse(null);
    if (row == null) {
      try {
        refresh();
      } catch (WhatsAppSendException ex) {
        log.error("WHATSAPP template status refresh failed error={}", ex.getMessage());
        return false;
      }
      row = repository.findByTemplateNameAndLanguage(templateName, language).orElse(null);
    }
    return row != null && APPROVED.equals(row.getStatus());
  }

  public List<WhatsAppTemplateStatus> all() {
    return repository.findAll();
  }

  /** Must run inside a transaction. */
  private void upsert(String name, String status, String category, String reason) {
    Instant now = Instant.now();
    WhatsAppTemplateStatus row =
        repository.findByTemplateNameAndLanguage(name, WhatsAppTemplate.LANGUAGE).orElse(null);
    boolean changed = row == null || !row.getStatus().equals(status);
    if (row == null) {
      row = new WhatsAppTemplateStatus();
      row.setTemplateName(name);
      row.setLanguage(WhatsAppTemplate.LANGUAGE);
    }
    row.setStatus(status.substring(0, Math.min(status.length(), 16)));
    row.setCategory(category);
    row.setReason(reason == null ? null : reason.substring(0, Math.min(reason.length(), 500)));
    row.setCheckedAt(now);
    if (changed) {
      row.setChangedAt(now);
    }
    repository.save(row);
    if (changed) {
      if (BAD.contains(status)) {
        alerts.raise(ALERT_PREFIX + status, name, reason);
      } else if (APPROVED.equals(status)) {
        alerts.resolveAll(ALERT_PREFIX, name);
      }
    }
  }
}
