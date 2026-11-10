package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;

/** The manual tip after the change, and the professional's accumulated balance afterwards. */
public record ManualTipMutationResponse(ManualTipResponse tip, BigDecimal newBalance) {}
