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

  private final WhatsAppMessageStore store;
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
      WhatsAppGateway gateway,
      WhatsAppAccess access,
      WhatsAppTemplateStatusService templateStatus,
      WhatsAppSettings settings,
      ObjectMapper objectMapper) {
    this(store, gateway, access, templateStatus, settings, objectMapper, null);
  }

  /** Tests pass a direct executor ({@code Runnable::run}) to make the send synchronous. */
  WhatsAppDispatcher(
      WhatsAppMessageStore store,
      WhatsAppGateway gateway,
      WhatsAppAccess access,
      WhatsAppTemplateStatusService templateStatus,
      WhatsAppSettings settings,
      ObjectMapper objectMapper,
      Executor executor) {
    this.store = store;
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

  @Scheduled(fixedDelayString = "${app.femme.whatsapp.sweep-delay-ms:30000}")
  void sweep() {
    for (Long id : store.staleQueuedIds(Instant.now().minusSeconds(30))) {
      dispatchAsync(id);
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
        store.markFailed(messageId, ex.getCode().name());
        log.error(
            "WHATSAPP message failed tenantId={} messageId={} template={} error={}",
            m.getTenantId(),
            messageId,
            m.getTemplate(),
            ex.getCode());
      }
    } catch (RuntimeException ex) {
      // Even a bookkeeping failure must not escape into the executor thread silently.
      log.error("WHATSAPP dispatch error messageId={} error={}", messageId, ex.toString());
    }
  }
}
