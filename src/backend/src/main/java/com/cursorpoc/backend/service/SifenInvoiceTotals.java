package com.cursorpoc.backend.service;

import java.math.BigDecimal;

/**
 * SIFEN HU-03: the document's subtotals and totals — Manual Técnico V150, grupo F (campos
 * F001-F099). Every field here is a straight sum over {@link SifenInvoiceLine}, so it's always
 * consistent with the line detail by construction (AC-04).
 *
 * @param exemptSubtotal F002/dSubExe — sum of netTotal for EXENTO lines.
 * @param taxedSubtotal5 F004/dSub5 — sum of netTotal for GRAVADO lines at 5%.
 * @param taxedSubtotal10 F005/dSub10 — sum of netTotal for GRAVADO lines at 10%.
 * @param grossTotal F008/dTotOpe — exemptSubtotal + taxedSubtotal5 + taxedSubtotal10.
 * @param perLineDiscountTotal F009/dTotDesc — sum of each line's own discount (EA002), full-line
 *     amounts (each line's per-unit EA002 times its quantity).
 * @param globalDiscountTotal F033/dTotDescGlotem — sum of each line's global-discount share (EA004,
 *     computed from {@code globalDiscountPercent}), full-line amounts.
 * @param totalDiscount F011/dDescTotal — perLineDiscountTotal + globalDiscountTotal.
 * @param netTotal F014/dTotGralOpe — always {@code Invoice.total} exactly (AC-04), the real amount
 *     charged — not necessarily bit-for-bit equal to {@code grossTotal} (the sum of the lines'
 *     formula-driven EA008 values), since {@code globalDiscountPercent} applied per-unit can leave
 *     a small rounding gap; see {@link #roundingAdjustment}.
 * @param taxableBase5 F018/dBaseGrav5.
 * @param taxableBase10 F019/dBaseGrav10.
 * @param totalTaxableBase F020/dTBasGraIVA — taxableBase5 + taxableBase10.
 * @param iva5 F015/dIVA5.
 * @param iva10 F016/dIVA10.
 * @param totalIva F017/dTotIVA — iva5 + iva10.
 * @param globalDiscountPercent F010/dPorcDescTotal — the flat global-discount percentage applied to
 *     every line's unit price (see {@code SifenInvoiceDetailService.globalDiscountPercent}
 *     javadoc); zero when there's no global discount.
 * @param roundingAdjustment F012/dRedon — grossTotal minus netTotal: the rounding gap between the
 *     lines' formula-driven totals and the real invoice total (typically zero).
 */
public record SifenInvoiceTotals(
    BigDecimal exemptSubtotal,
    BigDecimal taxedSubtotal5,
    BigDecimal taxedSubtotal10,
    BigDecimal grossTotal,
    BigDecimal perLineDiscountTotal,
    BigDecimal globalDiscountTotal,
    BigDecimal totalDiscount,
    BigDecimal netTotal,
    BigDecimal taxableBase5,
    BigDecimal taxableBase10,
    BigDecimal totalTaxableBase,
    BigDecimal iva5,
    BigDecimal iva10,
    BigDecimal totalIva,
    BigDecimal globalDiscountPercent,
    BigDecimal roundingAdjustment) {}
