package com.cursorpoc.backend.web.dto;

import java.time.LocalDate;

public record FiscalStampResponse(
    long id,
    String stampNumber,
    LocalDate validFrom,
    /** {@code null} when the stamp has no end of validity (issue #290). */
    LocalDate validUntil,
    int rangeFrom,
    /** {@code null} when the stamp has no upper number (issue #290). */
    Integer rangeTo,
    int nextEmissionNumber,
    boolean active,
    boolean lockedAfterInvoice,
    int establishment,
    int expeditionPoint,
    boolean hasInvoices) {}
