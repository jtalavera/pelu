package com.cursorpoc.backend.domain.enums;

/**
 * SIFEN E731/iAfecIVA: how a line item is affected by IVA (Manual Técnico V150, sección E8.2).
 *
 * <p>{@link #EXONERADO} and {@link #GRAVADO_PARCIAL} are modeled for completeness against the
 * manual's four official values, but are not reachable today: {@code Tax} carries a single flat
 * rate per service (no Art. 83 exoneration flag, no split gravado/exento within one line), so every
 * line resolves to either {@link #GRAVADO} (rate &gt; 0) or {@link #EXENTO} (rate == 0).
 */
public enum SifenTaxAffectation {
  GRAVADO(1),
  EXONERADO(2),
  EXENTO(3),
  GRAVADO_PARCIAL(4);

  private final int sifenCode;

  SifenTaxAffectation(int sifenCode) {
    this.sifenCode = sifenCode;
  }

  public int sifenCode() {
    return sifenCode;
  }
}
