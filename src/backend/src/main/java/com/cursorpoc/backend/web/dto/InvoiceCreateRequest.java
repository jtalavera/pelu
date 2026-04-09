package com.cursorpoc.backend.web.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.List;

public record InvoiceCreateRequest(
    Long clientId,
    String clientDisplayName,
    String clientRucOverride,
    String discountType,
    BigDecimal discountValue,
    @NotEmpty @Valid List<InvoiceLineRequest> lines,
    @NotNull @NotEmpty @Valid List<InvoicePaymentAllocationRequest> payments) {}
