package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import java.math.BigDecimal;
import java.time.Instant;

/**
 * Issue #181: header-only row for the "Historial de comprobantes" Excel/PDF report. Loaded by a
 * single projection query ({@code InvoiceRepository#findReportRows}) — no lazy {@code lines} /
 * {@code paymentAllocations} / {@code client} initialization per invoice, unlike the paged list
 * DTO, which the report never needed (it shows only cabecera data).
 */
public record InvoiceReportRow(
    int invoiceNumber,
    String clientName,
    InvoiceStatus status,
    BigDecimal total,
    Instant issuedAt,
    SifenSubmissionStatus sifenSubmissionStatus) {}
