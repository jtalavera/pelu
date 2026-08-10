package com.cursorpoc.backend.service;

import java.util.List;

/**
 * SIFEN HU-15: the result of querying a previously-submitted batch's processing outcome ({@code
 * SiResultLoteDE}, {@link SifenBatchResultQueryClient}).
 *
 * @param batchResultCode {@code dCodResLot} — Manual Técnico V150 Tabla F / sección 12.3.3.3:
 *     {@code 0360} lote inexistente, {@code 0361} en procesamiento (not concluded yet — caller
 *     should poll again after {@code SifenBatchSubmissionResult#recommendedWaitSeconds}), {@code
 *     0362} procesamiento concluido ({@code documents} populated, one row per document), {@code
 *     0363} lote rechazado por contener tipos de DE distintos (the whole batch rejected, no
 *     per-document results ever produced).
 * @param documents per-document results — only populated when {@code batchResultCode} is {@code
 *     0362}.
 */
public record SifenBatchQueryResult(
    String batchResultCode, String batchResultMessage, List<SifenBatchDocumentResult> documents) {

  private static final String STILL_PROCESSING = "0361";
  private static final String CONCLUDED = "0362";

  /** AC-01: not yet finished — the caller should wait and query again. */
  public boolean stillProcessing() {
    return STILL_PROCESSING.equals(batchResultCode);
  }

  /** AC-01/AC-02: finished — {@link #documents} carries each document's real outcome. */
  public boolean concluded() {
    return CONCLUDED.equals(batchResultCode);
  }
}
