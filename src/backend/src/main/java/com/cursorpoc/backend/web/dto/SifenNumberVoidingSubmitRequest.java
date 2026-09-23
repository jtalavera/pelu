package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record SifenNumberVoidingSubmitRequest(@NotBlank @Size(min = 5, max = 500) String reason) {}
