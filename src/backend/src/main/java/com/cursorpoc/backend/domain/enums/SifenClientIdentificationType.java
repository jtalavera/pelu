package com.cursorpoc.backend.domain.enums;

/**
 * SIFEN HU-11 AC-02: the three-way choice this system's "identify client" form asks for, mapping
 * directly onto the real, live "Evento de Nominación" ({@code rGEveNom}) event's own {@code iTiOpe}
 * field ("Tipo de operacion: 1(B2B), 2(B2C), 4(B2F)" — confirmed 2026-07-28 against the real {@code
 * evento.wsdl.xsd1.xsd} fetched from {@code sifen-test.set.gov.py}, absent from Manual Técnico
 * V150's own text, see PROGRESS.md's HU-11 section). SIFEN's own model has no fourth code for "B2G"
 * or a company/person split within B2F — a foreign recipient is always {@code iTiOpe=4} regardless
 * of whether it's a company or a person, so this enum mirrors that exactly rather than inventing a
 * finer-grained split SIFEN itself doesn't support.
 */
public enum SifenClientIdentificationType {
  /** iTiOpe=1 (B2B): requires RUC (AC-03). */
  COMPANY,
  /** iTiOpe=2 (B2C): domestic person, identified by identity document. */
  PERSON,
  /** iTiOpe=4 (B2F): requires country + address (AC-04). */
  FOREIGN
}
