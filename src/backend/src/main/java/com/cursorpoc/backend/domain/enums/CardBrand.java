package com.cursorpoc.backend.domain.enums;

/**
 * E621/iDenTarj (Manual Técnico V150, sección E7.1.1): denominación de la tarjeta usada en un pago
 * con tarjeta de crédito/débito. {@code sifenDescription} is the fixed E622/dDesDenTarj text the
 * manual mandates for every code except {@link #OTHER}, which requires a user-supplied description.
 */
public enum CardBrand {
  VISA(1, "Visa"),
  MASTERCARD(2, "Mastercard"),
  AMEX(3, "American Express"),
  MAESTRO(4, "Maestro"),
  PANAL(5, "Panal"),
  CABAL(6, "Cabal"),
  OTHER(99, null);

  private final int sifenCode;
  private final String sifenDescription;

  CardBrand(int sifenCode, String sifenDescription) {
    this.sifenCode = sifenCode;
    this.sifenDescription = sifenDescription;
  }

  public int sifenCode() {
    return sifenCode;
  }

  public String sifenDescription() {
    return sifenDescription;
  }
}
