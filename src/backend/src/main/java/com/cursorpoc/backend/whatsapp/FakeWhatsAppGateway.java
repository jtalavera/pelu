package com.cursorpoc.backend.whatsapp;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * HU-WAP-01 (criterio 7): stand-in for Meta in e2e and tests. Keeps the outgoing messages so they
 * can be read through {@code WhatsAppTestSupportController}, can be told to fail the next sends,
 * and reports every catalog template as APPROVED unless a status is set explicitly. Only active
 * with {@code app.femme.whatsapp.provider=fake}, which only the {@code e2e} and {@code test}
 * profiles set — production defaults to {@code meta}.
 */
@Component
@ConditionalOnProperty(
    name = "app.femme.whatsapp.provider",
    havingValue = WhatsAppSettings.PROVIDER_FAKE)
public class FakeWhatsAppGateway implements WhatsAppGateway {

  /** A message the fake "sent". */
  public record SentMessage(String wamid, Instant at, WhatsAppOutboundMessage message) {}

  private final AtomicLong sequence = new AtomicLong();
  private final List<SentMessage> sent = new CopyOnWriteArrayList<>();
  private final Deque<WhatsAppSendException> pendingFailures = new ArrayDeque<>();
  private final Map<String, WhatsAppRemoteTemplate> templateOverrides = new ConcurrentHashMap<>();

  @Override
  public WhatsAppSendResult send(WhatsAppOutboundMessage message, Duration timeout) {
    synchronized (pendingFailures) {
      WhatsAppSendException failure = pendingFailures.pollFirst();
      if (failure != null) {
        throw failure;
      }
    }
    String wamid = "wamid.FAKE" + sequence.incrementAndGet();
    sent.add(new SentMessage(wamid, Instant.now(), message));
    return new WhatsAppSendResult(wamid);
  }

  /** A free-form reply the fake "sent". */
  public record SentSession(String wamid, Instant at, WhatsAppSessionMessage message) {}

  private final List<SentSession> sentSessions = new CopyOnWriteArrayList<>();

  @Override
  public WhatsAppSendResult sendSession(WhatsAppSessionMessage message, Duration timeout) {
    synchronized (pendingFailures) {
      WhatsAppSendException failure = pendingFailures.pollFirst();
      if (failure != null) {
        throw failure;
      }
    }
    String wamid = "wamid.FAKE" + sequence.incrementAndGet();
    sentSessions.add(new SentSession(wamid, Instant.now(), message));
    return new WhatsAppSendResult(wamid);
  }

  public List<SentSession> sentSessions() {
    return List.copyOf(sentSessions);
  }

  @Override
  public List<WhatsAppRemoteTemplate> listTemplates() {
    List<WhatsAppRemoteTemplate> out = new ArrayList<>();
    for (WhatsAppTemplate t : WhatsAppTemplate.values()) {
      WhatsAppRemoteTemplate override = templateOverrides.get(t.templateName());
      out.add(
          override != null
              ? override
              : new WhatsAppRemoteTemplate(
                  t.templateName(),
                  WhatsAppTemplate.LANGUAGE,
                  "APPROVED",
                  t.category().name(),
                  null));
    }
    return out;
  }

  public List<SentMessage> sentMessages() {
    return List.copyOf(sent);
  }

  public void clear() {
    sent.clear();
    sentSessions.clear();
    synchronized (pendingFailures) {
      pendingFailures.clear();
    }
    templateOverrides.clear();
  }

  /** The next {@code count} sends fail with {@code code}. */
  public void failNext(WhatsAppErrorCode code, int count) {
    synchronized (pendingFailures) {
      for (int i = 0; i < count; i++) {
        pendingFailures.addLast(new WhatsAppSendException(code));
      }
    }
  }

  public void setTemplateStatus(String templateName, String status, String reason) {
    WhatsAppTemplate t = WhatsAppTemplate.byName(templateName);
    templateOverrides.put(
        templateName,
        new WhatsAppRemoteTemplate(
            templateName,
            WhatsAppTemplate.LANGUAGE,
            status,
            t == null ? null : t.category().name(),
            reason));
  }
}
