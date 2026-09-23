package com.cursorpoc.backend.service;

/**
 * SIFEN HU-14: tipos de documento electrónico que este dominio homologa (C002/iTiDE) — confirmado
 * directamente contra el catálogo real de producción ({@code DE_Types_v150.xsd}, {@code tiTiDE}:
 * {@code "1|[4-7]|9|10"} y {@code tdDesTiDE}, descargados de {@code
 * https://ekuatia.set.gov.py/sifen/xsd/DE_Types_v150.xsd}, 2026-07-28), no adivinado. Se excluyen
 * deliberadamente los códigos que el catálogo real permite pero que esta peluquería nunca necesita:
 * 9 (Boleta de venta electrónica) y 10 (Boleta resimple electrónica) — variantes de factura
 * simplificada fuera del alcance de HU-14 (que solo pide nota de crédito/débito, autofactura y nota
 * de remisión) — y las variantes de exportación/importación de la Factura Electrónica (código 1),
 * que el propio XSD real tiene comentadas ({@code <!-- Factura electrónica de exportación -->}
 * etc.) y por lo tanto no están vigentes hoy en ningún ambiente.
 */
public enum SifenDocumentType {
  FACTURA(1, "Factura electrónica"),
  AUTOFACTURA(4, "Autofactura electrónica"),
  NOTA_CREDITO(5, "Nota de crédito electrónica"),
  NOTA_DEBITO(6, "Nota de débito electrónica"),
  NOTA_REMISION(7, "Nota de remisión electrónica");

  private final int sifenCode;
  private final String description;

  SifenDocumentType(int sifenCode, String description) {
    this.sifenCode = sifenCode;
    this.description = description;
  }

  /** C002/iTiDE. */
  public int sifenCode() {
    return sifenCode;
  }

  /** C003/dDesTiDE — literal exacto exigido por la enumeración cerrada del schema real. */
  public String description() {
    return description;
  }

  public static SifenDocumentType fromCode(int code) {
    for (SifenDocumentType type : values()) {
      if (type.sifenCode == code) {
        return type;
      }
    }
    throw new IllegalArgumentException("Unknown SIFEN iTiDE code: " + code);
  }
}
