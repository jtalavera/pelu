package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;

public record FiscalStampCreateRequest(
    @NotBlank String stampNumber,
    @NotNull LocalDate validFrom,
    @NotNull LocalDate validUntil,
    @NotNull Integer rangeFrom,
    @NotNull Integer rangeTo,
    @NotNull Integer initialEmissionNumber,
    /** SIFEN C005/dEst — SIFEN HU-02 AC-02. Optional: defaults to 1 ("001"). */
    Integer establishment,
    /** SIFEN C006/dPunExp — SIFEN HU-02 AC-02. Optional: defaults to 1 ("001"). */
    Integer expeditionPoint) {

  public FiscalStampCreateRequest(
      String stampNumber,
      LocalDate validFrom,
      LocalDate validUntil,
      Integer rangeFrom,
      Integer rangeTo,
      Integer initialEmissionNumber) {
    this(stampNumber, validFrom, validUntil, rangeFrom, rangeTo, initialEmissionNumber, null, null);
  }
}
