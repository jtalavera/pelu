package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.enums.SifenTaxAffectation;
import java.math.BigDecimal;

/**
 * SIFEN HU-03: one billed service, shaped for the manual's {@code gCamItem}/{@code gCamIVA} groups
 * (Manual Técnico V150, secciones E8/E8.1/E8.2).
 *
 * @param internalCode E701/dCodInt — unique within the document (AC-01).
 * @param description E708/dDesProSer, truncated to SIFEN's 120-char limit (AC-01/AC-02).
 * @param additionalInfo E714/dInfItem — the full description (up to 500 chars) when it doesn't fit
 *     in {@link #description}, {@code null} otherwise. This is how AC-02's up-to-2000-char
 *     descriptions survive SIFEN's stricter item-name limit without losing the detail.
 * @param quantity E711/dCantProSer (AC-01).
 * @param unitOfMeasureCode E709/cUniMed — always {@code "77"} (Unidad, Tabla 5): every service in
 *     this domain is billed per unit, never by weight/volume/package.
 * @param unitPrice E721/dPUniProSer, IVA-incluido (AC-01).
 * @param itemDiscountAmount EA002/dDescItem, per-unit — this line's own particular discount
 *     (AC-05).
 * @param globalDiscountAmount EA004/dDescGloItem, per-unit — the invoice-level global discount
 *     percentage applied to this line's own unit price. Per the manual, this is a flat percentage
 *     applied uniformly to every line, not the discount amount split by each line's weight (see
 *     {@code SifenInvoiceDetailService.globalDiscountPercent} javadoc).
 * @param netTotal EA008: (unitPrice - itemDiscountAmount - globalDiscountAmount) * quantity,
 *     IVA-incluido.
 * @param taxAffectation E731/iAfecIVA (AC-03).
 * @param taxProportion E733/dPropIVA — always 100 (see {@link SifenTaxAffectation} javadoc: no
 *     split gravado/exento within one line is representable today).
 * @param taxRatePercent E734/dTasaIVA — 0, 5 or 10 (AC-03).
 * @param taxableBase E735/dBasGravIVA (AC-03).
 * @param taxAmount E736/dLiqIVAItem (AC-03).
 */
public record SifenInvoiceLine(
    String internalCode,
    String description,
    String additionalInfo,
    int quantity,
    String unitOfMeasureCode,
    BigDecimal unitPrice,
    BigDecimal itemDiscountAmount,
    BigDecimal globalDiscountAmount,
    BigDecimal netTotal,
    SifenTaxAffectation taxAffectation,
    BigDecimal taxProportion,
    BigDecimal taxRatePercent,
    BigDecimal taxableBase,
    BigDecimal taxAmount) {

  /**
   * Combined discount for the whole line, for display (e.g. the printed KuDE PDF) — not a SIFEN XML
   * field itself, so unlike {@link #itemDiscountAmount}/{@link #globalDiscountAmount} this one is a
   * full-line total, not per-unit.
   */
  public BigDecimal totalDiscountAmount() {
    return itemDiscountAmount.add(globalDiscountAmount).multiply(BigDecimal.valueOf(quantity));
  }
}
