package com.cursorpoc.backend.web.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.List;

/**
 * Issue #175: payload for {@code POST /api/invoices/{id}/sifen/correct-and-resend} — the same
 * client / lines / discount / payments shape as {@link InvoiceCreateRequest}, minus {@code
 * serviceRecordId} (a rejected invoice is already detached from any ficha) and minus {@code
 * issuedAt} (the emission date is a CDC field and never changes for a same-number correction).
 * Reuses {@link InvoiceLineRequest} / {@link InvoicePaymentAllocationRequest} verbatim, including
 * the issue #170 card-brand fields.
 */
public record InvoiceCorrectionRequest(
    Long clientId,
    String clientDisplayName,
    String clientRucOverride,
    String clientIdentityDocumentOverride,
    String clientIdentityDocumentTypeOverride,
    String clientTaxpayerTypeOverride,
    String email,
    String discountType,
    BigDecimal discountValue,
    @NotEmpty @Valid List<InvoiceLineRequest> lines,
    @NotNull @NotEmpty @Valid List<InvoicePaymentAllocationRequest> payments) {}
