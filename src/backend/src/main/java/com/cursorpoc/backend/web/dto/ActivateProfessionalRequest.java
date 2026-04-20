package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record ActivateProfessionalRequest(
    @NotBlank String token,
    @NotBlank @Size(min = 8) String password,
    @NotBlank String confirmPassword) {}
