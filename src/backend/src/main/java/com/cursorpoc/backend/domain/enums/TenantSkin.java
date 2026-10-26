package com.cursorpoc.backend.domain.enums;

/**
 * Per-tenant UI skin (Flowbit brand manual, "Variación en Interfaces"). One accent color per type
 * of business; it only recolors the comb and the "i" dot of the logo plus accent details — the rest
 * of the interface keeps the main palette. The frontend maps each value to its accent (DURAZNO
 * #F3C6AE, CELESTE #C9D9E6, ROSA #F1AFC2); suggested salon types are DURAZNO = spa, CELESTE =
 * barbería, ROSA = peluquería (a hint only, any tenant may use any skin).
 */
public enum TenantSkin {
  DURAZNO,
  CELESTE,
  ROSA;

  public static final TenantSkin DEFAULT = DURAZNO;
}
