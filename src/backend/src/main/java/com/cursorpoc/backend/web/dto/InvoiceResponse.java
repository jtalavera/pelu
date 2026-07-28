package com.cursorpoc.backend.web.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record InvoiceResponse(
    Long id,
    int invoiceNumber,
    String invoiceNumberFormatted,
    String fiscalStampNumber,
    Long clientId,
    String clientDisplayName,
    String clientRucOverride,
    String clientIdentityDocumentOverride,
    String businessRuc,
    String status,
    BigDecimal subtotal,
    String discountType,
    BigDecimal discountValue,
    BigDecimal total,
    Instant issuedAt,
    Long cashSessionId,
    String voidReason,
    BigDecimal tipsAmount,
    Long serviceRecordId,
    List<InvoiceLineResponse> lines,
    List<InvoicePaymentAllocationResponse> payments,
    String sifenControlNumber,
    String sifenSubmissionStatus,
    String sifenSubmissionProtocolNumber,
    String sifenSubmissionResultCode,
    String sifenSubmissionMessage,
    String sifenQueryDocumentContent,
    String sifenVerificationUrl,
    // SIFEN HU-10 AC-02: the deadline (48h after sifenSubmittedAt) up to which cancellation is
    // still possible — null whenever the invoice isn't currently eligible (never approved, or
    // already cancelled) so the frontend doesn't need to reimplement that eligibility logic.
    Instant sifenCancellationDeadlineAt,
    // AC-05: historical record of the last cancellation attempt, whichever outcome it had.
    Instant sifenCancellationRequestedAt,
    String sifenCancellationRequestedByEmail,
    String sifenCancellationReason,
    String sifenCancellationResultCode,
    String sifenCancellationMessage,
    // SIFEN HU-11 AC-01: true only while this invoice is currently eligible for "identify client" —
    // approved, issued without client data, not yet identified — so the frontend doesn't need to
    // reimplement that eligibility logic (SifenInvoiceClientIdentificationService.requireEligible
    // is still the authoritative check the endpoint itself re-validates).
    boolean sifenClientIdentificationEligible,
    boolean sifenClientIdentified,
    // AC-05/AC-06: historical record of the last client-identification attempt, either outcome.
    Instant sifenClientIdentificationRequestedAt,
    String sifenClientIdentificationRequestedByEmail,
    String sifenClientIdentificationClientType,
    String sifenClientIdentificationName,
    String sifenClientIdentificationRuc,
    String sifenClientIdentificationIdentityDocument,
    String sifenClientIdentificationAddress,
    String sifenClientIdentificationCountryCode,
    String sifenClientIdentificationResultCode,
    String sifenClientIdentificationMessage) {}
