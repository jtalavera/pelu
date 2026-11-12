package com.cursorpoc.backend.web.dto;

import java.time.Instant;

/**
 * HU-68: "Ficha técnica" — the only client data a professional may read. Deliberately carries just
 * the client's name besides the sheet itself (no phone, email, documents, address, …).
 */
public record ClientTechnicalSheetResponse(
    long clientId,
    String clientName,
    boolean active,
    String notes,
    Instant notesUpdatedAt,
    String notesUpdatedBy,
    String colorFormula,
    Instant colorFormulaUpdatedAt,
    String colorFormulaUpdatedBy) {}
