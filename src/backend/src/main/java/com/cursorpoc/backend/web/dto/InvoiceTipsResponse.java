package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/**
 * The tips of an invoice (voided ones included, flagged) plus what the screen needs to offer adding
 * more: the cash register the new tips would enter, if any. {@code total} only counts the tips that
 * are not voided.
 */
public record InvoiceTipsResponse(
    Long invoiceId,
    String invoiceStatus,
    List<InvoiceTipItemResponse> items,
    BigDecimal total,
    Long openCashSessionId,
    Instant openCashSessionOpenedAt) {}
