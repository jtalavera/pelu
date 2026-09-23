package com.cursorpoc.backend.web.dto;

import com.cursorpoc.backend.domain.enums.SifenHomologationStatus;
import jakarta.validation.constraints.NotNull;

public record TenantSifenHomologationUpdateRequest(@NotNull SifenHomologationStatus status) {}
