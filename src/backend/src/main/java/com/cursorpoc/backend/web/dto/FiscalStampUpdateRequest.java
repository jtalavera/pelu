package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;

/**
 * Full replacement of a stamp's editable fields. Issue #290: while the stamp has no invoices every
 * field can change; once it has, only {@code validUntil}, {@code rangeTo} and (forward-only) {@code
 * nextEmissionNumber} can — see {@code FiscalStampService.update}.
 */
public record FiscalStampUpdateRequest(
    @NotBlank String stampNumber,
    @NotNull LocalDate validFrom,
    /** Optional: {@code null} means the stamp has no end of validity. */
    LocalDate validUntil,
    @NotNull Integer rangeFrom,
    /** Optional: {@code null} means the stamp has no upper number. */
    Integer rangeTo,
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
    Integer expeditionPoint) {}
