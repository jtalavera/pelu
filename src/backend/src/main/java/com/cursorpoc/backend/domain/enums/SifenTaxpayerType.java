package com.cursorpoc.backend.domain.enums;

/** Tipo de contribuyente del emisor (SIFEN D103/iTipCont) — SIFEN HU-02 AC-03. */
public enum SifenTaxpayerType {
  INDIVIDUAL(1),
  LEGAL_ENTITY(2);

  private final int sifenCode;

  SifenTaxpayerType(int sifenCode) {
    this.sifenCode = sifenCode;
  }

  public int sifenCode() {
    return sifenCode;
  }
}
