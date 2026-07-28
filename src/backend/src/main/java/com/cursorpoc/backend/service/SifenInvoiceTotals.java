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
 * @param perLineDiscountTotal F009/dTotDesc — sum of each line's own discount (EA002).
 * @param globalDiscountTotal F033/dTotDescGlotem — the invoice-level discount prorated across lines
 *     (EA004), summed back up.
 * @param totalDiscount F011/dDescTotal — perLineDiscountTotal + globalDiscountTotal.
 * @param netTotal F014/dTotGralOpe — grossTotal (no redondeo/comisión in this domain), always equal
 *     to {@code Invoice.total} (AC-04).
 * @param taxableBase5 F018/dBaseGrav5.
 * @param taxableBase10 F019/dBaseGrav10.
 * @param totalTaxableBase F020/dTBasGraIVA — taxableBase5 + taxableBase10.
 * @param iva5 F015/dIVA5.
 * @param iva10 F016/dIVA10.
 * @param totalIva F017/dTotIVA — iva5 + iva10.
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
    BigDecimal totalIva) {}
