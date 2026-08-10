package com.cursorpoc.backend.service;

import java.util.Optional;

/**
 * SIFEN HU-11 AC-04: a curated subset of {@code paisType} (Manual Técnico's country catalog,
 * Paises_v100.xsd) — the real live schema (fetched 2026-07-28 from {@code
 * sifen-test.set.gov.py/.../evento.wsdl.xsd1.xsd}) enumerates all 249 ISO-3166 alpha-3 codes with
 * their official Spanish name, e.g. {@code <xs:enumeration value="ARG"><xs:documentation>Argentina
 * </xs:documentation></xs:enumeration>}. Sending the full catalog to the frontend (and maintaining
 * i18n labels for 249 entries) is disproportionate for a hairdresser SaaS where a foreign client is
 * a rare edge case — this enum keeps the handful of countries realistically expected (bordering
 * countries + the biggest regional/tourism sources), each verified against the real enumeration
 * values so any code here is guaranteed accepted by SIFEN.
 *
 * <p><b>Known limitation, deliberately out of scope:</b> a foreign client from a country not listed
 * here has no way to be identified through this form today — same kind of scoping decision as
 * {@code SifenDocumentXmlService.buildReceiver}'s own department/city gap (HU-02). Expanding this
 * list to the full catalog is a small, mechanical follow-up if a real tenant ever needs it (just
 * add the entry here + its two i18n keys — {@code
 * femme.billing.history.detail.sifen.countries.<CODE>} — in {@code en.json}/{@code es.json}; the
 * frontend's own country list must stay in sync with this enum, see {@code
 * InvoiceDetailModal.tsx}).
 */
public enum SifenForeignCountry {
  ARG("Argentina"),
  BRA("Brasil"),
  URY("Uruguay"),
  BOL("Bolivia (Estado Plurinacional de)"),
  CHL("Chile"),
  PER("Perú"),
  COL("Colombia"),
  MEX("México"),
  USA("Estados Unidos de América"),
  CAN("Canadá"),
  ESP("España"),
  FRA("Francia"),
  ITA("Italia"),
  DEU("Alemania"),
  GBR("Reino Unido de Gran Bretaña e Irlanda del Norte"),
  CHN("China"),
  JPN("Japón");

  /**
   * cPaisRec's dDesPaisRe — the exact Spanish text the real SIFEN catalog documents for this code,
   * not a display label the app can localize away from.
   */
  private final String officialSpanishName;

  SifenForeignCountry(String officialSpanishName) {
    this.officialSpanishName = officialSpanishName;
  }

  public String officialSpanishName() {
    return officialSpanishName;
  }

  public static Optional<SifenForeignCountry> fromCode(String code) {
    if (code == null) {
      return Optional.empty();
    }
    for (SifenForeignCountry country : values()) {
      if (country.name().equals(code.trim().toUpperCase())) {
        return Optional.of(country);
      }
    }
    return Optional.empty();
  }
}
