package com.cursorpoc.backend.web.dto;

/**
 * HU-68: full replace of the client's technical sheet. Blank values clear the field. Length limits
 * are checked in the service so they map to dedicated error codes.
 */
public record ClientTechnicalSheetRequest(String notes, String colorFormula) {}
