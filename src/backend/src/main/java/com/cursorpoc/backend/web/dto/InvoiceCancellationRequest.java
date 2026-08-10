package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** SIFEN HU-10: GEC003/mOtEve — Manual Técnico V150 Schema XML 19 requires 5 to 500 characters. */
public record InvoiceCancellationRequest(@NotBlank @Size(min = 5, max = 500) String reason) {}
