package com.cursorpoc.backend.whatsapp;

import com.cursorpoc.backend.domain.WhatsAppMessage;
import com.cursorpoc.backend.repository.WhatsAppMessageRepository;
import java.time.Instant;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Short transactions over {@code whatsapp_messages}; the HTTP call is never inside one. */
@Service
public class WhatsAppMessageStore {

  private final WhatsAppMessageRepository repository;

  public WhatsAppMessageStore(WhatsAppMessageRepository repository) {
    this.repository = repository;
  }

  @Transactional
  public boolean claim(long id) {
    return repository.claim(id) == 1;
  }

  @Transactional(readOnly = true)
  public WhatsAppMessage get(long id) {
    return repository.findById(id).orElseThrow();
  }

  @Transactional
  public void markSent(long id, String wamid) {
    WhatsAppMessage m = repository.findById(id).orElseThrow();
    m.setStatus(WhatsAppMessage.SENT);
    m.setMetaMessageId(wamid);
    m.setSentAt(Instant.now());
    m.setErrorCode(null);
  }

  @Transactional
  public void markFailed(long id, String errorCode) {
    WhatsAppMessage m = repository.findById(id).orElseThrow();
    m.setStatus(WhatsAppMessage.FAILED);
    m.setErrorCode(errorCode);
    m.setFailedAt(Instant.now());
  }

  /** Records a send that already happened (or failed) synchronously, e.g. a verification code. */
  @Transactional
  public void recordImmediate(
      long tenantId,
      String purpose,
      String template,
      String recipient,
      String wamid,
      String errorCode) {
    WhatsAppMessage m = new WhatsAppMessage();
    Instant now = Instant.now();
    m.setTenantId(tenantId);
    m.setPurpose(purpose);
    m.setTemplate(template);
    m.setRecipient(recipient);
    // The payload of a verification code is never stored (it holds the code itself).
    m.setPayload("{}");
    m.setDedupKey(purpose + ":" + java.util.UUID.randomUUID());
    m.setAttempts(1);
    m.setQueuedAt(now);
    if (errorCode == null) {
      m.setStatus(WhatsAppMessage.SENT);
      m.setMetaMessageId(wamid);
      m.setSentAt(now);
    } else {
      m.setStatus(WhatsAppMessage.FAILED);
      m.setErrorCode(errorCode);
      m.setFailedAt(now);
    }
    repository.save(m);
  }

  @Transactional(readOnly = true)
  public List<Long> staleQueuedIds(Instant queuedBefore) {
    return repository
        .findTop50ByStatusAndQueuedAtBeforeOrderByIdAsc(WhatsAppMessage.QUEUED, queuedBefore)
        .stream()
        .map(WhatsAppMessage::getId)
        .toList();
  }
}
