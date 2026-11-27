package com.cursorpoc.backend.whatsapp;

import com.cursorpoc.backend.domain.WhatsAppMessage;
import com.cursorpoc.backend.domain.WhatsAppProcessedEvent;
import com.cursorpoc.backend.repository.WhatsAppMessageRepository;
import com.cursorpoc.backend.repository.WhatsAppProcessedEventRepository;
import java.time.Instant;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * HU-WAP-07: applies Meta's delivery statuses to our message rows. The salon is NEVER taken from
 * the request: the message is found by the {@code wamid} of what we sent, so the tenant comes from
 * our own record. Statuses can arrive out of order (read before delivered, repeated): the state
 * only moves forward and each notification is handled once.
 */
@Service
public class WhatsAppDeliveryService {

  private static final Logger log = LoggerFactory.getLogger(WhatsAppDeliveryService.class);

  /** What happened to a status notification. */
  public record Outcome(Long tenantId, Long failedMessageId) {
    static final Outcome IGNORED = new Outcome(null, null);
  }

  private final WhatsAppMessageRepository messages;
  private final WhatsAppProcessedEventRepository processed;
  private final WhatsAppConsentService consent;

  public WhatsAppDeliveryService(
      WhatsAppMessageRepository messages,
      WhatsAppProcessedEventRepository processed,
      WhatsAppConsentService consent) {
    this.messages = messages;
    this.processed = processed;
    this.consent = consent;
  }

  private static int rank(String status) {
    return switch (status) {
      case WhatsAppMessage.SENT -> 1;
      case WhatsAppMessage.DELIVERED -> 2;
      case WhatsAppMessage.READ -> 3;
      default -> 0; // QUEUED, SENDING
    };
  }

  /**
   * @param wamid the message id Meta assigned
   * @param metaStatus {@code sent}, {@code delivered}, {@code read} or {@code failed}
   * @param errorCode Meta's numeric error code for a {@code failed} status, if any
   * @param at when Meta says it happened (falls back to now)
   * @return which salon it belonged to, and the message id if it just FAILED (so the caller can
   *     send the email fallback after this transaction)
   */
  @Transactional
  public Outcome applyStatus(String wamid, String metaStatus, Integer errorCode, Instant at) {
    if (wamid == null || wamid.isBlank() || metaStatus == null) {
      return Outcome.IGNORED;
    }
    String status = metaStatus.toLowerCase();
    Optional<WhatsAppMessage> found = messages.findFirstByMetaMessageId(wamid);
    if (found.isEmpty()) {
      log.info("WHATSAPP status for an unknown message ignored status={}", status);
      return Outcome.IGNORED;
    }
    WhatsAppMessage m = found.get();
    String eventId = wamid + ":" + status;
    if (processed.existsById(eventId)) {
      return new Outcome(m.getTenantId(), null);
    }
    try {
      processed.saveAndFlush(new WhatsAppProcessedEvent(eventId, Instant.now()));
    } catch (DataIntegrityViolationException dup) {
      return new Outcome(m.getTenantId(), null); // a concurrent delivery of the same event
    }
    Instant when = at == null ? Instant.now() : at;
    int current = rank(m.getStatus());
    boolean failedNow = false;
    switch (status) {
      case "sent" -> {
        if (current < 1 && !WhatsAppMessage.FAILED.equals(m.getStatus())) {
          m.setStatus(WhatsAppMessage.SENT);
          m.setSentAt(m.getSentAt() == null ? when : m.getSentAt());
        }
      }
      case "delivered" -> {
        if (current < 2 && !WhatsAppMessage.FAILED.equals(m.getStatus())) {
          m.setStatus(WhatsAppMessage.DELIVERED);
        }
        if (m.getDeliveredAt() == null && !WhatsAppMessage.FAILED.equals(m.getStatus())) {
          m.setDeliveredAt(when);
        }
      }
      case "read" -> {
        if (current < 3 && !WhatsAppMessage.FAILED.equals(m.getStatus())) {
          m.setStatus(WhatsAppMessage.READ);
        }
        if (!WhatsAppMessage.FAILED.equals(m.getStatus())) {
          m.setReadAt(m.getReadAt() == null ? when : m.getReadAt());
          // A read implies it was delivered, even if that notice has not arrived (yet).
          if (m.getDeliveredAt() == null) {
            m.setDeliveredAt(when);
          }
        }
      }
      case "failed" -> {
        if (current < 2 && !WhatsAppMessage.FAILED.equals(m.getStatus())) {
          WhatsAppErrorCode code = MetaCloudWhatsAppGateway.classify(400, errorCode);
          m.setStatus(WhatsAppMessage.FAILED);
          m.setErrorCode(code.name());
          m.setFailedAt(when);
          failedNow = true;
          if (code == WhatsAppErrorCode.INVALID_RECIPIENT) {
            consent.markUnreachable(m.getRecipient(), "NO_WHATSAPP");
          }
        }
      }
      default -> log.info("WHATSAPP status ignored status={}", status);
    }
    return new Outcome(m.getTenantId(), failedNow ? m.getId() : null);
  }
}
