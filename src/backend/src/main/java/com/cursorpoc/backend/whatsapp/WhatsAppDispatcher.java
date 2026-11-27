package com.cursorpoc.backend.whatsapp;

import com.cursorpoc.backend.domain.WhatsAppMessage;
import jakarta.annotation.PreDestroy;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

/**
 * Sends the QUEUED messages after the originating transaction committed. A periodic sweep picks up
 * the rows whose wake-up was lost. In this increment a failed send is final (FAILED with a typed
 * error); the retries with backoff and the email fallback arrive with HU-WAP-07 (C1).
 */
@Service
public class WhatsAppDispatcher {

  private static final Logger log = LoggerFactory.getLogger(WhatsAppDispatcher.class);

  /** HU-WAP-07 criterio 3: waits before each retry of a transient failure (up to 3 retries). */
  static final java.time.Duration[] RETRY_DELAYS = {
    java.time.Duration.ofMinutes(1),
    java.time.Duration.ofMinutes(5),
    java.time.Duration.ofMinutes(15)
  };

  private final WhatsAppMessageStore store;
  private final WhatsAppConsentService consent;
  private final WhatsAppFallbackService fallback;
  private final WhatsAppGateway gateway;
  private final WhatsAppAccess access;
  private final WhatsAppTemplateStatusService templateStatus;
  private final WhatsAppSettings settings;
  private final ObjectMapper objectMapper;
  private final Executor executor;
  private final ExecutorService ownedExecutor;

  @Autowired
  public WhatsAppDispatcher(
      WhatsAppMessageStore store,
      WhatsAppConsentService consent,
      WhatsAppFallbackService fallback,
      WhatsAppGateway gateway,
      WhatsAppAccess access,
      WhatsAppTemplateStatusService templateStatus,
      WhatsAppSettings settings,
      ObjectMapper objectMapper) {
    this(store, consent, fallback, gateway, access, templateStatus, settings, objectMapper, null);
  }

  /** Tests pass a direct executor ({@code Runnable::run}) to make the send synchronous. */
  WhatsAppDispatcher(
      WhatsAppMessageStore store,
      WhatsAppConsentService consent,
      WhatsAppFallbackService fallback,
      WhatsAppGateway gateway,
      WhatsAppAccess access,
      WhatsAppTemplateStatusService templateStatus,
      WhatsAppSettings settings,
      ObjectMapper objectMapper,
      Executor executor) {
    this.store = store;
    this.consent = consent;
    this.fallback = fallback;
    this.gateway = gateway;
    this.access = access;
    this.templateStatus = templateStatus;
    this.settings = settings;
    this.objectMapper = objectMapper;
    if (executor == null) {
      this.ownedExecutor =
          new ThreadPoolExecutor(
              2,
              2,
              0L,
              TimeUnit.MILLISECONDS,
              new ArrayBlockingQueue<>(500),
              r -> {
                Thread t = new Thread(r, "whatsapp-dispatch");
                t.setDaemon(true);
                return t;
              });
      this.executor = this.ownedExecutor;
    } else {
      this.ownedExecutor = null;
      this.executor = executor;
    }
  }

  @PreDestroy
  void shutdown() {
    if (ownedExecutor != null) {
      ownedExecutor.shutdown();
    }
  }

  public void dispatchAsync(long messageId) {
    try {
      executor.execute(() -> dispatch(messageId));
    } catch (RejectedExecutionException ex) {
      // The sweep will find the row (still QUEUED) shortly.
      log.warn("WHATSAPP dispatch queue full; the sweep will pick up messageId={}", messageId);
    }
  }

  /**
   * Sends what is due (lost wake-ups, retries whose wait is over) and retries pending fallbacks.
   */
  @Scheduled(
      initialDelayString = "${app.femme.whatsapp.sweep-initial-delay-ms:30000}",
      fixedDelayString = "${app.femme.whatsapp.sweep-delay-ms:30000}")
  public void sweep() {
    Instant now = Instant.now();
    for (Long id : store.dueIds(now)) {
      dispatchAsync(id);
    }
    for (Long id : store.fallbackPendingIds(now.minus(java.time.Duration.ofDays(1)))) {
      fallback.sendIfEligible(id);
    }
  }

  /** Sends one queued message. Never throws: every outcome is recorded on the row. */
  public void dispatch(long messageId) {
    try {
      if (!store.claim(messageId)) {
        return; // already taken by another worker, or no longer QUEUED
      }
      WhatsAppMessage m = store.get(messageId);
      try {
        if (!"OTP".equals(m.getPurpose())) {
          WhatsAppConsentService.Block block =
              consent.blockFor(m.getTenantId(), m.getClientId(), m.getRecipient()).orElse(null);
          if (block == WhatsAppConsentService.Block.UNREACHABLE) {
            throw new WhatsAppSendException(WhatsAppErrorCode.INVALID_RECIPIENT);
          }
          if (block != null) {
            // Consent withdrawn or phone opted out since it was queued: not sent, no email either
            // (RT-11). The client asked not to be told over WhatsApp.
            store.markCancelled(messageId, block.name());
            log.info(
                "WHATSAPP message cancelled tenantId={} messageId={} reason={}",
                m.getTenantId(),
                messageId,
                block);
            return;
          }
        }
        access.requireAvailable(m.getTenantId());
        if (!templateStatus.isUsable(m.getTemplate(), WhatsAppTemplate.LANGUAGE)) {
          throw new WhatsAppSendException(WhatsAppErrorCode.TEMPLATE_UNAVAILABLE);
        }
        WhatsAppOutbox.StoredPayload p =
            objectMapper.readValue(m.getPayload(), WhatsAppOutbox.StoredPayload.class);
        WhatsAppOutboundMessage out =
            new WhatsAppOutboundMessage(
                m.getRecipient(), m.getTemplate(), p.language(), p.bodyParameters(), p.buttons());
        WhatsAppSendResult result =
            gateway.send(out, Duration.ofMillis(settings.getRequestTimeoutMs()));
        store.markSent(messageId, result.wamid());
      } catch (WhatsAppSendException ex) {
        handleFailure(m, ex);
      }
    } catch (RuntimeException ex) {
      // Even a bookkeeping failure must not escape into the executor thread silently.
      log.error("WHATSAPP dispatch error messageId={} error={}", messageId, ex.toString());
    }
  }

  /**
   * HU-WAP-07: a transient failure is retried after 1, 5 and 15 minutes; anything else (or the last
   * retry failing) is final and triggers the one-time email fallback. A number with no WhatsApp is
   * remembered so it is not tried again.
   */
  private void handleFailure(WhatsAppMessage m, WhatsAppSendException ex) {
    long id = m.getId();
    if (ex.getCode() == WhatsAppErrorCode.INVALID_RECIPIENT) {
      consent.markUnreachable(m.getRecipient(), "NO_WHATSAPP");
    }
    int attempts = m.getAttempts(); // already counts the try that just failed
    if (ex.isRetryable() && attempts <= RETRY_DELAYS.length) {
      Instant next = Instant.now().plus(RETRY_DELAYS[attempts - 1]);
      store.scheduleRetry(id, ex.getCode().name(), next);
      log.warn(
          "WHATSAPP send will be retried tenantId={} messageId={} attempt={} error={}",
          m.getTenantId(),
          id,
          attempts,
          ex.getCode());
      return;
    }
    store.markFailed(id, ex.getCode().name());
    log.error(
        "WHATSAPP message failed tenantId={} messageId={} template={} attempts={} error={}",
        m.getTenantId(),
        id,
        m.getTemplate(),
        attempts,
        ex.getCode());
    fallback.sendIfEligible(id);
  }
}
