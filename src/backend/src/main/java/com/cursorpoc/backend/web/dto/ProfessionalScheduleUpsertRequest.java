package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotNull;
import java.util.List;

public record ProfessionalScheduleUpsertRequest(
    @NotNull List<ProfessionalScheduleRequest> schedules) {}
