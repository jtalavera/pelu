package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;

public record TaxResponse(long id, String name, BigDecimal rate, boolean active) {}
