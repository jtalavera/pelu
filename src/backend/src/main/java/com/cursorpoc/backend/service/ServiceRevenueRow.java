package com.cursorpoc.backend.service;

import java.math.BigDecimal;

/**
 * Issue #220 — "Dashboard: gráfico de servicios más vendidos". Aggregated revenue for one linked
 * {@code SalonService}, loaded by {@code
 * InvoiceRepository#findServiceRevenueByTenantAndStatusAndIssuedBetween} (grouped/summed in SQL,
 * ordered by revenue descending) and capped to the top N by {@code
 * DashboardService#buildTopServices} — same lightweight-projection pattern as {@link
 * InvoiceRevenueRow} and {@link InvoiceReportRow}.
 */
public record ServiceRevenueRow(String serviceName, BigDecimal totalRevenue) {}
