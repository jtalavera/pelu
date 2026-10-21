package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record ResetPasswordRequest(
    @NotBlank String token, @NotBlank @Size(max = 128) String newPassword) {}
