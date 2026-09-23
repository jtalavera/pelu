package com.cursorpoc.backend.service;

import java.time.Duration;

/**
 * RT-20 (Hardening_SIFEN.md): the queue an already-signed, {@code QUEUED} invoice's transmit
 * attempt goes through — never a direct call from the request thread. Real deployments use {@link
 * ServiceBusSifenSubmissionQueue} (Azure Service Bus, Basic tier); the {@code e2e} profile (RT-08)
 * uses {@link LocalAsyncSifenSubmissionQueue} instead, selected by {@code
 * app.femme.servicebus.enabled} — same conditional pattern as {@code SifenCertificateSecretStore}.
 *
 * <p>Deliberately minimal: everything beyond {@code tenantId}/{@code invoiceId} is re-read from the
 * database by the consumer inside its lease claim (see {@code
 * SifenInvoiceSubmissionPersistenceService#claimForSubmission}) — that's what makes the app-level
 * dedup RT-20 requires actually correct, not just the message payload.
 */
public interface SifenSubmissionQueue {

  /**
   * Enqueues a transmit attempt. {@code delay} lets a caller schedule a future attempt (backoff);
   * pass {@link Duration#ZERO} for immediate processing (the normal case right after issuance).
   */
  void enqueue(long tenantId, long invoiceId, int attempt, Duration delay, String correlationId);
}
