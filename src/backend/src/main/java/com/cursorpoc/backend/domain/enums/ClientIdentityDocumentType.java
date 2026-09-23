package com.cursorpoc.backend.domain.enums;

/**
 * SIFEN D3 (receptor): tipo de identificación explícito del cliente/receptor, reemplazando la
 * detección implícita por presencia de RUC vs. documento de identidad. {@code RUC} nunca puebla
 * {@code iTipIDRec} — usa en cambio {@code iTiContRec}+{@code dRucRec}+{@code dDVRec} (D206/D207).
 * El resto puebla {@code iTipIDRec} (D208) con {@code sifenCode} y {@code dDTipIDRec} (D209) con
 * {@code description}. Manual Técnico V150, catálogo D208 (p.71).
 */
public enum ClientIdentityDocumentType {
  RUC(null, null),
  CEDULA_PARAGUAYA(1, "Cédula paraguaya"),
  PASAPORTE(2, "Pasaporte"),
  CEDULA_EXTRANJERA(3, "Cédula extranjera"),
  CARNET_RESIDENCIA(4, "Carnet de residencia"),
  TARJETA_DIPLOMATICA(6, "Tarjeta Diplomática de exoneración fiscal"),
  OTRO(9, "Otro"),
  INNOMINADO(5, "Innominado");

  private final Integer sifenCode;
  private final String description;

  ClientIdentityDocumentType(Integer sifenCode, String description) {
    this.sifenCode = sifenCode;
    this.description = description;
  }

  public Integer sifenCode() {
    return sifenCode;
  }

  public String description() {
    return description;
  }

  /**
   * Resolves the effective type for a receiver: the explicit type if one was recorded, otherwise
   * the same implicit detection used before this enum existed (RUC if a RUC is present, else Cédula
   * paraguaya if a document number is present, else Innominado) — so every legacy client/invoice
   * without a stored type keeps producing byte-identical SIFEN XML.
   */
  public static ClientIdentityDocumentType resolve(
      ClientIdentityDocumentType explicit, String ruc, String identityDocumentNumber) {
    if (explicit != null) return explicit;
    if (ruc != null && !ruc.isBlank()) return RUC;
    if (identityDocumentNumber != null && !identityDocumentNumber.isBlank()) {
      return CEDULA_PARAGUAYA;
    }
    return INNOMINADO;
  }
}
