package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotNull;

public record ServiceRecordLineRequest(@NotNull Long serviceId, @NotNull Long professionalId) {}
