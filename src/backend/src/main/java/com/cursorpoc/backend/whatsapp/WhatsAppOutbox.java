package com.cursorpoc.backend.whatsapp;

import com.cursorpoc.backend.domain.WhatsAppMessage;
import com.cursorpoc.backend.repository.WhatsAppMessageRepository;
import java.time.Instant;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.databind.ObjectMapper;

/**
 * HU-WAP-01 (criterio 3): the queued send mode. {@link #enqueue} writes the message as QUEUED in
 * the CALLER's transaction (the appointment created, approved, cancelled…) and the send happens
 * only after that transaction commits. If the caller rolls back there is no message; if the send
 * fails the caller's change is NOT undone (RT-14).
 */
@Service
public class WhatsAppOutbox {

  /** What is stored in {@code payload}; the recipient has its own column. */
  record StoredPayload(
      String language,
      java.util.List<String> bodyParameters,
      java.util.List<WhatsAppButton> buttons) {}

  private final WhatsAppMessageRepository repository;
  private final WhatsAppDispatcher dispatcher;
  private final ObjectMapper objectMapper;

  public WhatsAppOutbox(
      WhatsAppMessageRepository repository,
      WhatsAppDispatcher dispatcher,
      ObjectMapper objectMapper) {
    this.repository = repository;
    this.dispatcher = dispatcher;
    this.objectMapper = objectMapper;
  }

  /**
   * Queues {@code message}. One message per {@code dedupKey} and tenant: a repeat returns the
   * existing row without sending again.
   */
  @Transactional
  public WhatsAppMessage enqueue(
      long tenantId,
      Long appointmentId,
      Long clientId,
      String purpose,
      WhatsAppOutboundMessage message,
      String dedupKey) {
    return enqueue(tenantId, appointmentId, clientId, purpose, message, dedupKey, null);
  }

  /**
   * As above, with the address of the one-time email fallback (HU-WAP-07 criterio 5): used if
   * WhatsApp fails for good, the number is unreachable, or the template is not usable. Without an
   * address a failure is only recorded.
   */
  @Transactional
  public WhatsAppMessage enqueue(
      long tenantId,
      Long appointmentId,
      Long clientId,
      String purpose,
      WhatsAppOutboundMessage message,
      String dedupKey,
      String fallbackEmail) {
    WhatsAppMessage existing =
        repository.findByTenantIdAndDedupKey(tenantId, dedupKey).orElse(null);
    if (existing != null) {
      return existing;
    }
    WhatsAppMessage m = new WhatsAppMessage();
    m.setTenantId(tenantId);
    m.setAppointmentId(appointmentId);
    m.setClientId(clientId);
    m.setPurpose(purpose);
    m.setTemplate(message.templateName());
    m.setRecipient(message.to());
    m.setPayload(
        objectMapper.writeValueAsString(
            new StoredPayload(
                message.languageCode(), message.bodyParameters(), message.buttons())));
    m.setDedupKey(dedupKey);
    m.setFallbackEmail(
        fallbackEmail == null || fallbackEmail.isBlank() ? null : fallbackEmail.trim());
    m.setStatus(WhatsAppMessage.QUEUED);
    m.setQueuedAt(Instant.now());
    WhatsAppMessage saved = repository.saveAndFlush(m);
    long id = saved.getId();
    if (TransactionSynchronizationManager.isSynchronizationActive()) {
      TransactionSynchronizationManager.registerSynchronization(
          new TransactionSynchronization() {
            @Override
            public void afterCommit() {
              dispatcher.dispatchAsync(id);
            }
          });
    } else {
      dispatcher.dispatchAsync(id);
    }
    return saved;
  }

  /**
   * Records a notice that WhatsApp cannot carry (no consent, opted-out, channel off, bad phone…) as
   * a FAILED row WITH the reason, and sends the email fallback after the caller's transaction
   * commits (HU-WAP-04, criterio 6). Without an email address it only stays recorded, so the salon
   * can see it needs a phone call. One row per {@code dedupKey}, like {@link #enqueue}.
   */
  @Transactional
  public WhatsAppMessage enqueueUndeliverable(
      long tenantId,
      Long appointmentId,
      Long clientId,
      String purpose,
      WhatsAppOutboundMessage message,
      String dedupKey,
      String fallbackEmail,
      String reason) {
    WhatsAppMessage existing =
        repository.findByTenantIdAndDedupKey(tenantId, dedupKey).orElse(null);
    if (existing != null) {
      return existing;
    }
    WhatsAppMessage m = new WhatsAppMessage();
    Instant now = Instant.now();
    m.setTenantId(tenantId);
    m.setAppointmentId(appointmentId);
    m.setClientId(clientId);
    m.setPurpose(purpose);
    m.setTemplate(message.templateName());
    m.setRecipient(message.to() == null || message.to().isBlank() ? "n/a" : message.to());
    m.setPayload(
        objectMapper.writeValueAsString(
            new StoredPayload(
                message.languageCode(), message.bodyParameters(), message.buttons())));
    m.setDedupKey(dedupKey);
    m.setFallbackEmail(
        fallbackEmail == null || fallbackEmail.isBlank() ? null : fallbackEmail.trim());
    m.setStatus(WhatsAppMessage.FAILED);
    m.setErrorCode(reason);
    m.setAttempts(0);
    m.setQueuedAt(now);
    m.setFailedAt(now);
    WhatsAppMessage saved = repository.saveAndFlush(m);
    long id = saved.getId();
    if (saved.getFallbackEmail() != null) {
      if (TransactionSynchronizationManager.isSynchronizationActive()) {
        TransactionSynchronizationManager.registerSynchronization(
            new TransactionSynchronization() {
              @Override
              public void afterCommit() {
                dispatcher.fallbackAsync(id);
              }
            });
      } else {
        dispatcher.fallbackAsync(id);
      }
    }
    return saved;
  }

  /**
   * Cancels the still-QUEUED notices of an appointment (a reschedule or a cancellation makes them
   * stale). {@code keepDedupSuffix} spares the ones that belong to the current schedule version.
   * Returns how many were cancelled.
   */
  @Transactional
  public int cancelQueued(
      long tenantId,
      long appointmentId,
      java.util.Collection<String> purposes,
      String keepDedupSuffix,
      String reason) {
    int n = 0;
    for (WhatsAppMessage m :
        repository.findByTenantIdAndAppointmentIdAndStatusAndPurposeIn(
            tenantId, appointmentId, WhatsAppMessage.QUEUED, purposes)) {
      if (keepDedupSuffix != null && m.getDedupKey().endsWith(keepDedupSuffix)) {
        continue;
      }
      m.setStatus(WhatsAppMessage.CANCELLED);
      m.setErrorCode(reason);
      m.setNextAttemptAt(null);
      n++;
    }
    return n;
  }
}
