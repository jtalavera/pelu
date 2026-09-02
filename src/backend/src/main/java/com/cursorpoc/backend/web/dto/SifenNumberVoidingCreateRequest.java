package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * RT-25 "manual" path: an ADMIN declares a range of unused document numbers voided. Range bounds
 * and reason are re-validated against the active fiscal stamp in {@code
 * SifenNumberVoidingService.createManual}.
 */
public record SifenNumberVoidingCreateRequest(
    @NotNull @Min(1) Integer rangeFrom,
    @NotNull @Min(1) Integer rangeTo,
    @NotBlank @Size(min = 5, max = 500) String reason) {}
