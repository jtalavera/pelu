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
    String economicActivityDescription,
    /** SIFEN D111/cDepEmi — SIFEN HU-04. Null clears it. */
    String sifenDepartmentCode,
    String sifenDepartmentName,
    /** SIFEN D115/cCiuEmi — SIFEN HU-04. Null clears it. */
    String sifenCityCode,
    String sifenCityName) {

  public BusinessProfileUpdateRequest(
      String businessName,
      String ruc,
      String address,
      String phone,
      String contactEmail,
      String logoDataUrl) {
    this(
        businessName,
        ruc,
        address,
        phone,
        contactEmail,
        logoDataUrl,
        null,
        null,
        null,
        null,
        null,
        null,
        null);
  }

  public BusinessProfileUpdateRequest(
      String businessName,
      String ruc,
      String address,
      String phone,
      String contactEmail,
      String logoDataUrl,
      String taxpayerType,
      String economicActivityCode,
      String economicActivityDescription) {
    this(
        businessName,
        ruc,
        address,
        phone,
        contactEmail,
        logoDataUrl,
        taxpayerType,
        economicActivityCode,
        economicActivityDescription,
        null,
        null,
        null,
        null);
  }
}
