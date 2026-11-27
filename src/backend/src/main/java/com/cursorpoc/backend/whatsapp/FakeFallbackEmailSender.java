package com.cursorpoc.backend.whatsapp;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/** e2e/test sender (provider {@code fake}): keeps the fallback emails and can be made to fail. */
@Component
@ConditionalOnProperty(
    name = "app.femme.whatsapp.provider",
    havingValue = WhatsAppSettings.PROVIDER_FAKE)
public class FakeFallbackEmailSender implements FallbackEmailSender {

  public record SentEmail(String to, String subject, String body, Instant at) {}

  private final List<SentEmail> sent = new CopyOnWriteArrayList<>();
  private final Deque<Boolean> failures = new ArrayDeque<>();

  @Override
  public void send(String toEmail, String subject, String body) {
    synchronized (failures) {
      if (failures.pollFirst() != null) {
        throw new IllegalStateException("EMAIL_SEND_FAILED");
      }
    }
    sent.add(new SentEmail(toEmail, subject, body, Instant.now()));
  }

  public List<SentEmail> sentEmails() {
    return List.copyOf(sent);
  }

  public void failNext(int count) {
    synchronized (failures) {
      for (int i = 0; i < count; i++) {
        failures.addLast(Boolean.TRUE);
      }
    }
  }

  public void clear() {
    sent.clear();
    synchronized (failures) {
      failures.clear();
    }
  }
}
