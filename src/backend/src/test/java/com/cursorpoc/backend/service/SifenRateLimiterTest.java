package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** RT-22 (Hardening_SIFEN.md). */
class SifenRateLimiterTest {

  @Test
  void requireCapacity_allowsCallsUpToTheConfiguredBudget() {
    SifenRateLimiter limiter = new SifenRateLimiter(3, 60);

    limiter.requireCapacity(1L);
    limiter.requireCapacity(1L);
    limiter.requireCapacity(1L);
    // No exception thrown for the first 3 calls within the window — nothing further to assert.
  }

  @Test
  void requireCapacity_rejectsTheCallThatExceedsTheBudget() {
    SifenRateLimiter limiter = new SifenRateLimiter(2, 60);
    limiter.requireCapacity(1L);
    limiter.requireCapacity(1L);

    assertThatThrownBy(() -> limiter.requireCapacity(1L))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_RATE_LIMIT_EXCEEDED")
        .satisfies(
            e ->
                assertThat(((ResponseStatusException) e).getStatusCode())
                    .isEqualTo(HttpStatus.TOO_MANY_REQUESTS));
  }

  /** RT-22: one tenant's usage must never affect another's budget. */
  @Test
  void requireCapacity_isolatesBudgetsPerTenant() {
    SifenRateLimiter limiter = new SifenRateLimiter(1, 60);
    limiter.requireCapacity(1L);

    // Tenant 1 is out of budget, but tenant 2 has its own independent window.
    assertThatThrownBy(() -> limiter.requireCapacity(1L))
        .isInstanceOf(ResponseStatusException.class);
    limiter.requireCapacity(2L);
  }

  @Test
  void requireCapacity_refillsAfterTheWindowElapses() throws InterruptedException {
    SifenRateLimiter limiter = new SifenRateLimiter(1, 0);
    limiter.requireCapacity(1L);

    // A zero-second window means every call starts a fresh window.
    limiter.requireCapacity(1L);
  }
}
