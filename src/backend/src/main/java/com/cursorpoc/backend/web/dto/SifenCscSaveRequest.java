package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotNull;

/**
 * {@code idCsc}: the "IdCSC" the DNIT assigned (1–9999). {@code csc}: the 32-character alphanumeric
 * code itself. Saving an {@code idCsc} the tenant already has replaces its value.
 */
public record SifenCscSaveRequest(@NotNull Integer idCsc, String csc) {

  @Override
  public String toString() {
    return "SifenCscSaveRequest[idCsc=" + idCsc + ", csc=***]";
  }
}
