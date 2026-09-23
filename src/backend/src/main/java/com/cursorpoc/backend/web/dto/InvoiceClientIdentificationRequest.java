package com.cursorpoc.backend.web.dto;

import com.cursorpoc.backend.domain.enums.SifenClientIdentificationType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * SIFEN HU-11 AC-02: minimum fields the "identify client" form collects. {@code ruc}/{@code
 * identityDocumentNumber}/{@code address}/{@code countryCode} are conditionally required depending
 * on {@code clientType} — validated in {@code SifenInvoiceClientIdentificationService}, not here
 * via bean validation, since the specific AC-03/AC-04 error codes the frontend translates need to
 * differ from a generic "field required" message.
 */
public record InvoiceClientIdentificationRequest(
    @NotNull SifenClientIdentificationType clientType,
    String ruc,
    String identityDocumentNumber,
    @NotBlank @Size(min = 2, max = 255) String name,
    String address,
    String countryCode) {}
