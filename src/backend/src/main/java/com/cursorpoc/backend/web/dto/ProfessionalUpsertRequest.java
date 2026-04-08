package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.List;

public record ProfessionalUpsertRequest(
    @NotBlank String fullName,
    String phone,
    String email,
    String photoDataUrl,
    @NotNull List<ProfessionalScheduleRequest> schedules) {}
