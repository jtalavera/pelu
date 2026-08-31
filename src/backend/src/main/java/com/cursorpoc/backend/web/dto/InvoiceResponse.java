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
    // Issue #167: the linked client's own email on file, if any — lets the frontend prefill the
    // KuDE-by-email field without a separate client lookup. Null whenever there's no linked client
    // or that client has no email; the backend already falls back to it server-side regardless (see
    // SifenKudeEmailService#resolveRecipientEmail), this is purely so the field isn't left blank.
    String clientEmail,
    // Issue #173: the email captured on the comprobante form for this specific document (what the
    // KuDE / cancellation notice is actually sent to). May differ from clientEmail for an
    // occasional
    // client or when the operator typed a one-off address.
    String recipientEmail,
    String clientRucOverride,
    String clientIdentityDocumentOverride,
    /** Nombre de {@link com.cursorpoc.backend.domain.enums.ClientIdentityDocumentType}, o null. */
    String clientIdentityDocumentTypeOverride,
    /** Nombre de {@link com.cursorpoc.backend.domain.enums.ClientTaxpayerType}, o null. */
    String clientTaxpayerTypeOverride,
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
    // Issue #145: the instant (sifenSubmittedAt + MINIMUM_CANCELLATION_DELAY) from which
    // cancellation is actually accepted — same null-guard as sifenCancellationDeadlineAt, so the
    // frontend can disable the cancel button and show a short cooldown message instead of letting
    // the user hit SIFEN's own "extemporáneo" rejection for a just-approved invoice.
    Instant sifenCancellationAvailableAt,
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
    String sifenClientIdentificationMessage,
    // Issue #173: set once the KuDE for this document was auto-emailed after a successful SIFEN
    // result; null until then (and while SIFEN hasn't approved it).
    Instant sifenKudeEmailedAt,
    // Issue #173: set once the client was emailed a cancellation notice for this document; null
    // until then (and while the document hasn't been cancelled with SIFEN).
    Instant sifenCancellationNotifiedAt) {}
