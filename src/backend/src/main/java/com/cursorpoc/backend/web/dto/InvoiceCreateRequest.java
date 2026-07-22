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
    @NotNull @NotEmpty @Valid List<InvoicePaymentAllocationRequest> payments,
    /** Optional link to the "ficha de servicio" this invoice was generated from. */
    Long serviceRecordId,
    /**
     * Optional tips collected alongside this invoice. Added to the required payment sum but never
     * to subtotal/discount/total — tips are not part of the fiscal comprobante.
     */
    BigDecimal tipsAmount) {}
