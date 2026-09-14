package com.cursorpoc.backend.service;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * Issue #219 — "Dashboard: fundamentos de gráficos + tendencia de facturación". Single-invoice
 * projection ({@code issuedAt}/{@code total} only) loaded by {@code
 * InvoiceRepository#findRevenueRowsByTenantAndStatusAndIssuedBetween} and bucketed into calendar
 * days (business timezone) by {@code DashboardService#buildRevenueTrend} — kept lightweight, like
 * {@link InvoiceReportRow}, since day-bucketing needs nothing else off the invoice.
 */
public record InvoiceRevenueRow(Instant issuedAt, BigDecimal total) {}
