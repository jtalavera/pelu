package com.cursorpoc.backend.web.dto;

import java.time.LocalDate;
import java.util.List;

/**
 * Issue #194: paged "Numeración inutilizada" list. Mirrors {@link PagedInvoicesResponse}'s shape,
 * plus a cross-page summary ({@code pendingCount} / {@code soonestPendingDeadline}) so the tab's "X
 * inutilizaciones pendientes" line stays accurate while the user is on page 2+. {@code
 * soonestPendingDeadline} is null when nothing is pending.
 */
public record PagedSifenNumberVoidingResponse(
    List<SifenNumberVoidingEventResponse> content,
    int page,
    int size,
    long totalElements,
    int totalPages,
    int pendingCount,
    LocalDate soonestPendingDeadline) {}
