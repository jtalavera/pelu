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
    /** Cédula u otro documento de identidad para un cliente ocasional — SIFEN HU-02 AC-05. */
    String clientIdentityDocumentOverride,
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
    BigDecimal tipsAmount,
    /** Nombre de {@link com.cursorpoc.backend.domain.enums.ClientIdentityDocumentType}, o null. */
    String clientIdentityDocumentTypeOverride,
    /** Nombre de {@link com.cursorpoc.backend.domain.enums.ClientTaxpayerType}, o null. */
    String clientTaxpayerTypeOverride,
    /**
     * Issue #173: email address to send this comprobante's KuDE to. Required to emit when SIFEN
     * e-invoicing is enabled unless the receiver is unidentified ("Sin identificar"). A new value
     * is also written back to the linked client's profile.
     */
    String email,
    /**
     * Issue #174 AC-04: optional ISO-8601 instant overriding the emission date. Only honoured when
     * the form's "editar fecha" checkbox was ticked; must sit within SIFEN's -720h/+120h window.
     */
    String issuedAt) {

  public InvoiceCreateRequest(
      Long clientId,
      String clientDisplayName,
      String clientRucOverride,
      String discountType,
      BigDecimal discountValue,
      List<InvoiceLineRequest> lines,
      List<InvoicePaymentAllocationRequest> payments,
      Long serviceRecordId,
      BigDecimal tipsAmount) {
    this(
        clientId,
        clientDisplayName,
        clientRucOverride,
        null,
        discountType,
        discountValue,
        lines,
        payments,
        serviceRecordId,
        tipsAmount,
        null,
        null,
        null,
        null);
  }

  public InvoiceCreateRequest(
      Long clientId,
      String clientDisplayName,
      String clientRucOverride,
      String clientIdentityDocumentOverride,
      String discountType,
      BigDecimal discountValue,
      List<InvoiceLineRequest> lines,
      List<InvoicePaymentAllocationRequest> payments,
      Long serviceRecordId,
      BigDecimal tipsAmount) {
    this(
        clientId,
        clientDisplayName,
        clientRucOverride,
        clientIdentityDocumentOverride,
        discountType,
        discountValue,
        lines,
        payments,
        serviceRecordId,
        tipsAmount,
        null,
        null,
        null,
        null);
  }

  public InvoiceCreateRequest(
      Long clientId,
      String clientDisplayName,
      String clientRucOverride,
      String clientIdentityDocumentOverride,
      String discountType,
      BigDecimal discountValue,
      List<InvoiceLineRequest> lines,
      List<InvoicePaymentAllocationRequest> payments,
      Long serviceRecordId,
      BigDecimal tipsAmount,
      String clientIdentityDocumentTypeOverride) {
    this(
        clientId,
        clientDisplayName,
        clientRucOverride,
        clientIdentityDocumentOverride,
        discountType,
        discountValue,
        lines,
        payments,
        serviceRecordId,
        tipsAmount,
        clientIdentityDocumentTypeOverride,
        null,
        null,
        null);
  }
}
