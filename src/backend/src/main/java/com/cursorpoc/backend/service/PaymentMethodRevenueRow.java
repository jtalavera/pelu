package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.enums.PaymentMethod;
import java.math.BigDecimal;

/**
 * Issue #221 — "Dashboard: gráfico de mezcla de medios de pago". Aggregated invoiced revenue for
 * one {@code PaymentMethod}, loaded by {@code
 * InvoiceRepository#findPaymentMethodRevenueByTenantAndStatusAndIssuedBetween} (grouped by {@code
 * p.method} in SQL, summed, ordered by amount descending then method ascending). Unlike {@link
 * ServiceRevenueRow} (which had to group by a mutable/duplicable {@code SalonService} name), {@code
 * PaymentMethod} is a fixed enum — grouping directly on it carries no risk of two distinct "things"
 * silently merging under one label, so there's no separate id/name split here.
 */
public record PaymentMethodRevenueRow(PaymentMethod method, BigDecimal totalAmount) {}
