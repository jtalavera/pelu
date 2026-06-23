package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;
import java.util.List;

/**
 * Paged invoice list result. Includes {@code issuedTotal}: the sum of {@code total} for all ISSUED
 * invoices matching the current filter (across ALL pages, not just the current page). This lets the
 * "Total del día" KPI remain accurate even when the user is viewing page 2+.
 */
public record PagedInvoicesResponse(
    List<InvoiceListItemResponse> content,
    int page,
    int size,
    long totalElements,
    int totalPages,
    BigDecimal issuedTotal) {}
