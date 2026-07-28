package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotBlank;

public record BusinessProfileUpdateRequest(
    @NotBlank String businessName,
    String ruc,
    String address,
    String phone,
    String contactEmail,
    String logoDataUrl,
    /** "INDIVIDUAL" or "LEGAL_ENTITY" — SIFEN HU-02 AC-03. Null clears it. */
    String taxpayerType,
    String economicActivityCode,
    String economicActivityDescription) {

  public BusinessProfileUpdateRequest(
      String businessName,
      String ruc,
      String address,
      String phone,
      String contactEmail,
      String logoDataUrl) {
    this(businessName, ruc, address, phone, contactEmail, logoDataUrl, null, null, null);
  }
}
