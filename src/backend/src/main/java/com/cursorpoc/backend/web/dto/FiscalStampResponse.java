package com.cursorpoc.backend.web.dto;

import java.time.LocalDate;

public record FiscalStampResponse(
    long id,
    String stampNumber,
    LocalDate validFrom,
    LocalDate validUntil,
    int rangeFrom,
    int rangeTo,
    int nextEmissionNumber,
    boolean active,
    boolean lockedAfterInvoice) {}
