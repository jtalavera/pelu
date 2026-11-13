package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * One tip of an invoice. {@code source} is {@code ISSUANCE} for a tip entered on the comprobante
 * (collected with its payments: it carries no payment method of its own and cannot be voided from
 * here) or {@code LATE} for one left after the invoice was issued (it has its own payment method
 * and enters the open cash register). {@code cashSessionOpen} tells whether the register the late
 * tip entered is still open, i.e. whether it can still be voided.
 */
public record InvoiceTipItemResponse(
    String source,
    Long id,
    Long professionalId,
    String professionalName,
    BigDecimal amount,
    String paymentMethod,
    String cardBrand,
    String cardBrandOtherDescription,
    Instant createdAt,
    String createdByName,
    boolean voided,
    String voidReason,
    String voidedByName,
    boolean cashSessionOpen) {}
