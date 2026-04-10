package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;

public record InvoicePaymentAllocationResponse(String method, BigDecimal amount) {}
