package com.cursorpoc.backend.service;

import java.time.Instant;

/**
 * RT-20 (Hardening_SIFEN.md): the Service Bus message body — deliberately minimal (see {@link
 * SifenSubmissionQueue}'s javadoc for why). {@code schemaVersion} exists because the queue outlives
 * a deploy: a rolling revision can have both an old and a new consumer running against the same
 * queue at once.
 */
public record SifenSubmissionMessagePayload(
    int schemaVersion,
    long tenantId,
    long invoiceId,
    int attempt,
    String correlationId,
    Instant enqueuedAt) {

  public static final int CURRENT_SCHEMA_VERSION = 1;
}
