package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotBlank;

public record ClientRequest(
    @NotBlank String fullName,
    String phone,
    String email,
    String ruc,
    /** Cédula u otro documento de identidad — SIFEN HU-02 AC-05. */
    String identityDocumentNumber,
    String address,
    /** SIFEN HU-02 AC-07 — D219/cDepRec, código DNIT del departamento. */
    String departmentCode,
    /** SIFEN HU-02 AC-07 — D220/dDesDepRec. */
    String departmentName,
    /** SIFEN HU-02 AC-07 — D223/cCiuRec, código DNIT de la ciudad. */
    String cityCode,
    /** SIFEN HU-02 AC-07 — D224/dDesCiuRec. */
    String cityName,
    /** Nombre de {@link com.cursorpoc.backend.domain.enums.ClientIdentityDocumentType}, o null. */
    String identityDocumentType,
    /** Nombre de {@link com.cursorpoc.backend.domain.enums.ClientTaxpayerType}, o null. */
    String taxpayerType) {

  public ClientRequest(String fullName, String phone, String email, String ruc) {
    this(fullName, phone, email, ruc, null, null, null, null, null, null, null, null);
  }

  public ClientRequest(
      String fullName,
      String phone,
      String email,
      String ruc,
      String identityDocumentNumber,
      String address,
      String departmentCode,
      String departmentName,
      String cityCode,
      String cityName) {
    this(
        fullName,
        phone,
        email,
        ruc,
        identityDocumentNumber,
        address,
        departmentCode,
        departmentName,
        cityCode,
        cityName,
        null,
        null);
  }

  public ClientRequest(
      String fullName,
      String phone,
      String email,
      String ruc,
      String identityDocumentNumber,
      String address,
      String departmentCode,
      String departmentName,
      String cityCode,
      String cityName,
      String identityDocumentType) {
    this(
        fullName,
        phone,
        email,
        ruc,
        identityDocumentNumber,
        address,
        departmentCode,
        departmentName,
        cityCode,
        cityName,
        identityDocumentType,
        null);
  }
}
