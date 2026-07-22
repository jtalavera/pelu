package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotBlank;

public record ServiceRecordVoidRequest(@NotBlank String voidReason) {}
