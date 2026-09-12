package com.cursorpoc.backend.service;

import java.math.BigDecimal;

/**
 * Issue #220 — "Dashboard: gráfico de servicios más vendidos". Aggregated revenue for one linked
 * {@code SalonService}, loaded by {@code
 * InvoiceRepository#findServiceRevenueByTenantAndStatusAndIssuedBetween} (grouped by {@code
 * serviceId} in SQL — {@code services.name} has no unique constraint, so grouping by name alone
 * would silently merge two distinct services that happen to share a name — summed, ordered by
 * revenue descending then name ascending) and capped to the top N by {@code
 * DashboardService#buildTopServices} — same lightweight-projection pattern as {@link
 * InvoiceRevenueRow} and {@link InvoiceReportRow}. {@code serviceId} isn't used downstream ( {@code
 * DashboardResponse.TopService} only carries name/revenue) but is kept here since it's the actual
 * SQL grouping key.
 */
public record ServiceRevenueRow(Long serviceId, String serviceName, BigDecimal totalRevenue) {}
