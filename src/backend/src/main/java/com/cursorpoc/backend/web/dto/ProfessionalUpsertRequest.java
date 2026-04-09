package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotBlank;

public record ProfessionalUpsertRequest(
    @NotBlank String fullName, String phone, String email, String photoDataUrl) {}
