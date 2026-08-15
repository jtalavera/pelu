package com.cursorpoc.backend.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.azure.core.util.BinaryData;
import com.azure.messaging.servicebus.ServiceBusReceivedMessage;
import com.azure.messaging.servicebus.ServiceBusReceivedMessageContext;
import com.azure.messaging.servicebus.models.DeadLetterOptions;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/** RT-20 (Hardening_SIFEN.md). */
@ExtendWith(MockitoExtension.class)
class ServiceBusSifenMessageHandlerTest {

  @Mock private SifenSubmissionQueueListener listener;
  @Mock private ServiceBusReceivedMessageContext context;
  @Mock private ServiceBusReceivedMessage message;

  private ServiceBusSifenMessageHandler handler;

  @BeforeEach
  void setUp() {
    // The real ObjectMapper bean is Spring Boot's own, auto-registered with JavaTimeModule
    // (jackson-datatype-jsr310) — replicate that here so Instant fields deserialize the same way.
    handler =
        new ServiceBusSifenMessageHandler(listener, new ObjectMapper().findAndRegisterModules());
    when(context.getMessage()).thenReturn(message);
  }

  private static BinaryData validBody() {
    return BinaryData.fromString(
        "{\"schemaVersion\":1,\"tenantId\":1,\"invoiceId\":100,\"attempt\":1,"
            + "\"correlationId\":\"corr-1\",\"enqueuedAt\":\""
            + Instant.now()
            + "\"}");
  }

  @Test
  void handle_dispatchesToListener_andCompletes_onCompletedOutcome() {
    when(message.getBody()).thenReturn(validBody());
    when(listener.processMessage(1L, 100L, 1, "corr-1"))
        .thenReturn(SifenSubmissionQueueListener.Outcome.COMPLETED);

    handler.handle(context);

    verify(context).complete();
    verify(context, never()).deadLetter(any(DeadLetterOptions.class));
  }

  @Test
  void handle_completes_onRetryScheduledOutcome_ratherThanLeavingTheMessageOutstanding() {
    when(message.getBody()).thenReturn(validBody());
    when(listener.processMessage(1L, 100L, 1, "corr-1"))
        .thenReturn(SifenSubmissionQueueListener.Outcome.RETRY_SCHEDULED);

    handler.handle(context);

    verify(context).complete();
  }

  @Test
  void handle_deadLetters_onDeadLetteredOutcome() {
    when(message.getBody()).thenReturn(validBody());
    when(listener.processMessage(1L, 100L, 1, "corr-1"))
        .thenReturn(SifenSubmissionQueueListener.Outcome.DEAD_LETTERED);

    handler.handle(context);

    verify(context)
        .deadLetter(argThat(o -> "SIFEN_TRANSMIT_FAILED".equals(o.getDeadLetterReason())));
    verify(context, never()).complete();
  }

  @Test
  void handle_deadLetters_withoutCallingTheListener_whenTheBodyIsNotParseable() {
    when(message.getBody()).thenReturn(BinaryData.fromString("not json"));

    handler.handle(context);

    verify(listener, never()).processMessage(anyLong(), anyLong(), anyInt(), any());
    verify(context)
        .deadLetter(argThat(o -> "SIFEN_MESSAGE_PARSE_ERROR".equals(o.getDeadLetterReason())));
  }
}
