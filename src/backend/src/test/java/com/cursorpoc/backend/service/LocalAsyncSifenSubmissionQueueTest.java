package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.mockito.Mockito.verify;

import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * RT-08/RT-20 (Hardening_SIFEN.md). Genuinely asynchronous — {@link
 * SifenSubmissionQueueListener#processMessage} must not run on the calling thread.
 */
@ExtendWith(MockitoExtension.class)
class LocalAsyncSifenSubmissionQueueTest {

  @Mock private SifenSubmissionQueueListener listener;

  @Test
  void enqueue_runsOnABackgroundThread_notTheCallingThread() {
    var queue = new LocalAsyncSifenSubmissionQueue(listener);
    long callingThreadId = Thread.currentThread().threadId();

    queue.enqueue(1L, 100L, 1, Duration.ZERO, "corr-1");

    await()
        .atMost(Duration.ofSeconds(2))
        .untilAsserted(() -> verify(listener).processMessage(1L, 100L, 1, "corr-1"));
    assertThat(Thread.currentThread().threadId()).isEqualTo(callingThreadId);
  }

  @Test
  void enqueue_delaysProcessing_byAtLeastTheRequestedDuration() {
    var queue = new LocalAsyncSifenSubmissionQueue(listener);

    long enqueuedAtMillis = System.currentTimeMillis();
    queue.enqueue(1L, 100L, 1, Duration.ofMillis(300), "corr-1");

    await()
        .atMost(Duration.ofSeconds(2))
        .untilAsserted(() -> verify(listener).processMessage(1L, 100L, 1, "corr-1"));
    assertThat(System.currentTimeMillis() - enqueuedAtMillis).isGreaterThanOrEqualTo(280);
  }
}
