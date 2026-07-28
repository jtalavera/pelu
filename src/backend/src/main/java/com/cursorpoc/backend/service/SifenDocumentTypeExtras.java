package com.cursorpoc.backend.service;

/**
 * SIFEN HU-14: grupos específicos por tipo de documento electrónico, adicionales al header/ítems/
 * totales que {@link SifenInvoiceHeader}/{@link SifenInvoiceDetail} ya modelan para cualquier DE.
 * Como máximo un campo no nulo por instancia — cada tipo de documento activa exactamente un grupo
 * adicional (o ninguno, para factura — {@link #NONE}).
 */
public record SifenDocumentTypeExtras(
    SifenCreditDebitNoteData creditDebitNote,
    SifenAutoInvoiceProviderData autoInvoiceProvider,
    SifenGoodsRemissionData goodsRemission) {

  public static final SifenDocumentTypeExtras NONE = new SifenDocumentTypeExtras(null, null, null);

  public static SifenDocumentTypeExtras creditDebitNote(SifenCreditDebitNoteData data) {
    return new SifenDocumentTypeExtras(data, null, null);
  }

  public static SifenDocumentTypeExtras autoInvoiceProvider(SifenAutoInvoiceProviderData data) {
    return new SifenDocumentTypeExtras(null, data, null);
  }

  public static SifenDocumentTypeExtras goodsRemission(SifenGoodsRemissionData data) {
    return new SifenDocumentTypeExtras(null, null, data);
  }
}
