package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import java.time.LocalDateTime;

/**
 * SIFEN HU-06: the outcome of one submission attempt to SIFEN's synchronous reception service.
 *
 * @param status mapped from {@code dEstRes}, or {@link SifenSubmissionStatus#PENDING_VERIFICATION}
 *     if no response was received at all (AC-05).
 * @param protocolNumber dProtAut — SIFEN's "número de trámite" (AC-02/AC-03), absent on rejection.
 * @param resultCode dCodRes of the first {@code gResProc} entry.
 * @param message every {@code gResProc}'s dMsgRes, joined with {@code "; "} — AC-03/AC-04 need the
 *     observation/rejection detail, and SIFEN can return more than one (verified live).
 * @param processedAt when this result was recorded.
 */
public record SifenSubmissionResult(
    SifenSubmissionStatus status,
    String protocolNumber,
    String resultCode,
    String message,
    LocalDateTime processedAt) {}
