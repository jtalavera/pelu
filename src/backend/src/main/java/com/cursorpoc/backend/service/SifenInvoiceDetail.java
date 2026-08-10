package com.cursorpoc.backend.service;

import java.util.List;

/**
 * SIFEN HU-03: the billed-services detail and totals for a document, ready for HU-04 to attach to
 * HU-02's {@link SifenInvoiceHeader} and sign.
 *
 * @param lines one per billed service (AC-01).
 * @param totals subtotals/totals derived from {@code lines} (AC-03/AC-04/AC-05).
 * @param paymentCondition always {@code 1} (Contado) — this system never issues an invoice with an
 *     unpaid balance (payments must sum to the total at issuance time), so E601/iCondOpe=2
 *     (Crédito) is unreachable.
 * @param payments cash-sale payment breakdown (AC-06).
 */
public record SifenInvoiceDetail(
    List<SifenInvoiceLine> lines,
    SifenInvoiceTotals totals,
    int paymentCondition,
    List<SifenPaymentDetail> payments) {}
