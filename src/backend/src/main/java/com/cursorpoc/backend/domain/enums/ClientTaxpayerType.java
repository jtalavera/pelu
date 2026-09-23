package com.cursorpoc.backend.domain.enums;

/**
 * SIFEN D3 (receptor): D205/iTiContRec — tipo de contribuyente del receptor, obligatorio siempre
 * que se informa RUC (D201=1) y prohibido en caso contrario. Manual Técnico V150, campo D205
 * (p.71). Antes de este enum, {@code SifenDocumentXmlService} enviaba siempre {@code
 * PERSONA_FISICA} sin importar el cliente real — {@link #PERSONA_FISICA} sigue siendo el valor por
 * defecto cuando no se informa explícitamente, para no cambiar el comportamiento de datos legados.
 */
public enum ClientTaxpayerType {
  PERSONA_FISICA(1),
  PERSONA_JURIDICA(2);

  private final int sifenCode;

  ClientTaxpayerType(int sifenCode) {
    this.sifenCode = sifenCode;
  }

  public int sifenCode() {
    return sifenCode;
  }
}
