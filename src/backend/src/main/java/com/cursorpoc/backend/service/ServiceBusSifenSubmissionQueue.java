package com.cursorpoc.backend.service;

import com.azure.messaging.servicebus.ServiceBusMessage;
import com.azure.messaging.servicebus.ServiceBusSenderClient;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.UncheckedIOException;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

/**
 * RT-20 (Hardening_SIFEN.md): the real, production {@link SifenSubmissionQueue} — Azure Service
 * Bus, Basic tier. {@code delay} is implemented with {@code scheduleMessage} (native scheduled
 * messages) rather than a manual delay-then-send, since Basic tier supports it; zero delay sends
 * immediately instead, so the happy path never waits on a scheduler round trip.
 */
@Service
@ConditionalOnProperty(
    name = "app.femme.servicebus.enabled",
    havingValue = "true",
    matchIfMissing = true)
public class ServiceBusSifenSubmissionQueue implements SifenSubmissionQueue {

  private static final Logger log = LoggerFactory.getLogger(ServiceBusSifenSubmissionQueue.class);

  private final ServiceBusSenderClient senderClient;
  private final ObjectMapper objectMapper;

  public ServiceBusSifenSubmissionQueue(
      ServiceBusSenderClient senderClient, ObjectMapper objectMapper) {
    this.senderClient = senderClient;
    this.objectMapper = objectMapper;
  }

  @Override
  public void enqueue(
      long tenantId, long invoiceId, int attempt, Duration delay, String correlationId) {
    SifenSubmissionMessagePayload payload =
        new SifenSubmissionMessagePayload(
            SifenSubmissionMessagePayload.CURRENT_SCHEMA_VERSION,
            tenantId,
            invoiceId,
            attempt,
            correlationId,
            Instant.now());
    String json;
    try {
      json = objectMapper.writeValueAsString(payload);
    } catch (JsonProcessingException e) {
      throw new UncheckedIOException(e);
    }

    ServiceBusMessage message = new ServiceBusMessage(json);
    message.setMessageId("sifen-tx-" + tenantId + "-" + invoiceId + "-" + attempt);
    message.setCorrelationId(correlationId);

    if (delay.isZero() || delay.isNegative()) {
      senderClient.sendMessage(message);
    } else {
      senderClient.scheduleMessage(message, OffsetDateTime.now(ZoneOffset.UTC).plus(delay));
    }
    log.info(
        "SIFEN submission enqueued tenantId={} invoiceId={} attempt={} delaySeconds={}",
        tenantId,
        invoiceId,
        attempt,
        delay.toSeconds());
  }
}
