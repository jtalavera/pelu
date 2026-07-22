package com.cursorpoc.backend.web.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.List;

/** Used for both creating and updating a service record — a full replace of lines/tips. */
public record ServiceRecordRequest(
    @NotNull Long clientId,
    @NotEmpty @Valid List<ServiceRecordLineRequest> lines,
    @Valid List<ServiceRecordTipRequest> tips) {}
