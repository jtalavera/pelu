package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotNull;

public record AppointmentAssignServiceRecordRequest(@NotNull Long serviceRecordId) {}
