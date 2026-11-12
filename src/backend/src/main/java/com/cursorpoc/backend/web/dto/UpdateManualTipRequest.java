package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * Body of {@code PUT /api/propinas/manual/{id}}: the professional is fixed once created. Fields are
 * checked in the service so each failure answers with its own error code.
 */
public record UpdateManualTipRequest(BigDecimal amount, Instant tippedAt, String note) {}
