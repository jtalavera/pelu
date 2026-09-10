package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record ActivateProfessionalRequest(
    @NotBlank String token,
    @NotBlank @Size(min = 8) String password,
    @NotBlank String confirmPassword,
    // HU-41 follow-up: only sent (and only required) by the Platform-Admin-invited tenant ADMIN
    // flow — a professional's name already lives on Professional#fullName. Enforced in
    // AuthService#activateAccount for the app-user branch, not here.
    @Size(max = 255) String fullName) {}
