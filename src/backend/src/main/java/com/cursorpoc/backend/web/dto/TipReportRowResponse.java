package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * One tip in the report. Rows that come from a ficha or a comprobante carry only the first five
 * fields; a manual tip also carries its id, note, who loaded it and, when voided, who/why (voided
 * rows are shown but never counted in any total).
 */
public record TipReportRowResponse(
    Long professionalId,
    String professionalName,
    BigDecimal amount,
    String clientName,
    Instant serviceDateTime,
    Long manualTipId,
    String note,
    String createdByName,
    boolean voided,
    String voidReason,
    String voidedByName) {

  public TipReportRowResponse(
      Long professionalId,
      String professionalName,
      BigDecimal amount,
      String clientName,
      Instant serviceDateTime) {
    this(
        professionalId,
        professionalName,
        amount,
        clientName,
        serviceDateTime,
        null,
        null,
        null,
        false,
        null,
        null);
  }
}
