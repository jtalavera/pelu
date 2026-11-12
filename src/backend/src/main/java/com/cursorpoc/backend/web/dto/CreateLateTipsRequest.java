package com.cursorpoc.backend.web.dto;

import jakarta.validation.Valid;
import java.util.List;

/** Body of {@code POST /api/invoices/{id}/tips}: all the tips are saved together or none is. */
public record CreateLateTipsRequest(@Valid List<LateTipRequest> tips) {}
