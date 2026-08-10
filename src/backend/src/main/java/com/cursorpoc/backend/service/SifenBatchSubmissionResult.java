package com.cursorpoc.backend.service;

/**
 * SIFEN HU-15: the immediate acknowledgment SIFEN's asynchronous batch reception service ({@code
 * SiRecepLoteDE}) returns for a submitted lote — never the final per-document outcome, since batch
 * processing is asynchronous (that's {@link SifenBatchResultQueryClient}'s job, using {@code
 * batchNumber}).
 *
 * @param accepted {@code dCodRes=0300} ("Lote recibido con éxito") vs. anything else (e.g. {@code
 *     0301} "Lote no encolado para procesamiento") — Manual Técnico V150 sección 12.3.2.3,
 *     confirmed against the live {@code resRecepLoteDE} response shape.
 * @param batchNumber {@code dProtConsLote} — per the live XSD, only guaranteed present when {@code
 *     accepted}; the tracking number {@link SifenBatchResultQueryClient} needs to poll for the
 *     final result.
 * @param recommendedWaitSeconds {@code dTpoProces} ("Tiempo medio de procesamiento en segundos") —
 *     SIFEN's own, per-batch dynamic estimate of processing time. This integration uses it as HU-15
 *     AC-01's "tiempo mínimo recomendado antes de consultar", since the manual never publishes a
 *     fixed wait constant anywhere else — see {@link SifenBatchReceptionClient}'s class Javadoc.
 */
public record SifenBatchSubmissionResult(
    boolean accepted,
    String resultCode,
    String message,
    String batchNumber,
    Integer recommendedWaitSeconds) {}
