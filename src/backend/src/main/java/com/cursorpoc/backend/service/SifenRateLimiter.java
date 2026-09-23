package com.cursorpoc.backend.service;

import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * RT-22 (Hardening_SIFEN.md): a per-tenant rate limit toward SIFEN, so a bug or abuse in one tenant
 * can't exhaust the rate SIFEN applies to its own certificate/RUC, or trigger network throttling
 * that affects every tenant sharing this backend's egress. Consulted at the same five real
 * (non-homologación) SIFEN call sites {@link SifenCallMetrics} wraps.
 *
 * <p>A fixed-window counter, not a true token bucket — deliberately simple, hand-rolled (no new
 * dependency), and more than adequate for this app's real traffic (a single salon issuing at most a
 * few dozen invoices a day, never a burst that needs smooth rate smoothing). Each tenant gets its
 * own independent window (a {@code ConcurrentHashMap} entry) — one tenant hitting its limit never
 * affects another's budget.
 *
 * <p>Under RT-20's async model, exceeding this limit during a queue consumer's transmit attempt is
 * retriable, not terminal — see {@code SifenSubmissionQueueListener#handleException}'s {@code
 * TOO_MANY_REQUESTS} branch, which re-enqueues with backoff instead of failing the invoice.
 */
@Service
public class SifenRateLimiter {

  private final int maxCallsPerWindow;
  private final Duration window;
  private final ConcurrentHashMap<Long, TenantWindow> windows = new ConcurrentHashMap<>();

  public SifenRateLimiter(
      @Value("${app.femme.sifen.rate-limit.max-calls-per-window:30}") int maxCallsPerWindow,
      @Value("${app.femme.sifen.rate-limit.window-seconds:60}") long windowSeconds) {
    this.maxCallsPerWindow = maxCallsPerWindow;
    this.window = Duration.ofSeconds(windowSeconds);
  }

  /** Throws {@code SIFEN_RATE_LIMIT_EXCEEDED} (429) if this tenant is over budget right now. */
  public void requireCapacity(long tenantId) {
    TenantWindow tenantWindow = windows.computeIfAbsent(tenantId, id -> new TenantWindow());
    if (!tenantWindow.tryConsume(maxCallsPerWindow, window)) {
      throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "SIFEN_RATE_LIMIT_EXCEEDED");
    }
  }

  private static final class TenantWindow {
    private Instant windowStart = Instant.EPOCH;
    private int count;

    synchronized boolean tryConsume(int maxCallsPerWindow, Duration window) {
      Instant now = Instant.now();
      if (Duration.between(windowStart, now).compareTo(window) >= 0) {
        windowStart = now;
        count = 0;
      }
      if (count >= maxCallsPerWindow) {
        return false;
      }
      count++;
      return true;
    }
  }
}
