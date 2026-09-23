package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;

public record FiscalStampUpdateRequest(
    @NotNull LocalDate validFrom,
    @NotNull LocalDate validUntil,
    @NotNull Integer nextEmissionNumber,
    /**
     * SIFEN C005/dEst. Only allowed to change while no invoice has ever been issued against the
     * stamp — see {@code FiscalStampService.update}. Optional: defaults to 1 ("001").
     */
    Integer establishment,
    /**
     * SIFEN C006/dPunExp. Only allowed to change while no invoice has ever been issued against the
     * stamp — see {@code FiscalStampService.update}. Optional: defaults to 1 ("001").
     */
    Integer expeditionPoint) {

  public FiscalStampUpdateRequest(
      LocalDate validFrom, LocalDate validUntil, Integer nextEmissionNumber) {
    this(validFrom, validUntil, nextEmissionNumber, null, null);
  }
}
