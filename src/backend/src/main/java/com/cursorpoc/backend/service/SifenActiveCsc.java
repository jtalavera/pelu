package com.cursorpoc.backend.service;

/**
 * The CSC a QR is signed with: the DNIT-assigned {@code idCsc} (printed as {@code IdCSC} in the QR)
 * and its secret value. Resolved per tenant by {@link SifenCscService#resolveActive}; never logged.
 */
public record SifenActiveCsc(int idCsc, String secret) {

  @Override
  public String toString() {
    return "SifenActiveCsc[idCsc=" + idCsc + ", secret=***]";
  }
}
