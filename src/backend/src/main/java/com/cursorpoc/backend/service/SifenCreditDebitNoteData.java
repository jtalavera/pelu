package com.cursorpoc.backend.service;

/**
 * SIFEN HU-14: campos que componen una nota de crédito/débito electrónica más allá de lo que ya
 * comparte con cualquier DE (mismo header/ítems/totales/firma) — el motivo de emisión ({@code
 * gCamNCDE}, dentro de {@code gDtipDE}) y la referencia obligatoria (AC-03) al CDC de la factura
 * previamente aprobada que esta nota ajusta ({@code gCamDEAsoc}, a nivel de documento, hermano de
 * {@code gTotSub} bajo {@code <DE>} — confirmado contra el schema real, {@code DE_v150.xsd}, {@code
 * tgCamDEAsoc}).
 *
 * @param reasonCode motivo de emisión (E-Types {@code tiMotEmi}, 1-8): 1=Devolución y Ajuste de
 *     precios, 2=Devolución, 3=Descuento, 4=Bonificación, 5=Crédito incobrable, 6=Recupero de
 *     costo, 7=Recupero de gasto, 8=Ajuste de precio.
 * @param referencedControlNumber CDC de 44 caracteres de la factura ya aprobada que esta nota
 *     referencia (AC-03) — {@code dCdCDERef} dentro de {@code gCamDEAsoc}.
 */
public record SifenCreditDebitNoteData(int reasonCode, String referencedControlNumber) {}
