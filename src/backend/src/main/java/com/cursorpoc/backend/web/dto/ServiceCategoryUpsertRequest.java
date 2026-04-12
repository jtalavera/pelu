package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotBlank;

public record ServiceCategoryUpsertRequest(@NotBlank String name, String accentKey) {}
