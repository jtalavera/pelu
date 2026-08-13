package com.cursorpoc.backend.service;

import com.azure.messaging.servicebus.ServiceBusReceivedMessageContext;
import com.azure.messaging.servicebus.models.DeadLetterOptions;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

/**
 * RT-20 (Hardening_SIFEN.md): bridges a real Service Bus message to {@link
 * SifenSubmissionQueueListener#processMessage}, then settles it (complete vs. dead-letter) based on
 * the {@link SifenSubmissionQueueListener.Outcome}. {@code RETRY_SCHEDULED} still completes the
 * message — the retry itself is driven by {@code sifen_next_attempt_at} + {@code
 * SifenSubmissionReconciler}, not by leaving this message outstanding.
 */
@Service
@ConditionalOnProperty(
    name = "app.femme.servicebus.enabled",
    havingValue = "true",
    matchIfMissing = true)
public class ServiceBusSifenMessageHandler {

  private static final Logger log = LoggerFactory.getLogger(ServiceBusSifenMessageHandler.class);

  private final SifenSubmissionQueueListener listener;
  private final ObjectMapper objectMapper;

  public ServiceBusSifenMessageHandler(
      SifenSubmissionQueueListener listener, ObjectMapper objectMapper) {
    this.listener = listener;
    this.objectMapper = objectMapper;
  }

  public void handle(ServiceBusReceivedMessageContext context) {
    SifenSubmissionMessagePayload payload;
    try {
      payload =
          objectMapper.readValue(
              context.getMessage().getBody().toString(), SifenSubmissionMessagePayload.class);
    } catch (Exception e) {
      log.error("SIFEN submission message could not be parsed, dead-lettering: {}", e.toString());
      context.deadLetter(new DeadLetterOptions().setDeadLetterReason("SIFEN_MESSAGE_PARSE_ERROR"));
      return;
    }

    SifenSubmissionQueueListener.Outcome outcome =
        listener.processMessage(
            payload.tenantId(), payload.invoiceId(), payload.attempt(), payload.correlationId());

    switch (outcome) {
      case COMPLETED, RETRY_SCHEDULED, SKIPPED_LEASE_HELD -> context.complete();
      case DEAD_LETTERED ->
          context.deadLetter(new DeadLetterOptions().setDeadLetterReason("SIFEN_TRANSMIT_FAILED"));
    }
  }
}
