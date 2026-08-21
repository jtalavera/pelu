package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

/** HU-41 AC-1: the Platform Admin only supplies the new admin's email — no password. */
public record CreateTenantAdminRequest(@NotBlank @Email String email) {}
