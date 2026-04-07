package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotBlank;

public record BusinessProfileUpdateRequest(
    @NotBlank String businessName,
    String ruc,
    String address,
    String phone,
    String contactEmail,
    String logoDataUrl) {}
