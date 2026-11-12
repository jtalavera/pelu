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
    String taxpayerType,
    /** HU-69: day + month together, year optional; all null = no birthday. */
    Integer birthdayDay,
    Integer birthdayMonth,
    Integer birthdayYear,
    /**
     * HU-69: name of {@link com.cursorpoc.backend.domain.enums.ClientAcquisitionChannel}, or null.
     */
    String acquisitionChannel,
    /** HU-69: detail when the channel is OTRO (max 100 chars). */
    String acquisitionChannelOther) {

  public ClientRequest(String fullName, String phone, String email, String ruc) {
    this(
        fullName, phone, email, ruc, null, null, null, null, null, null, null, null, null, null,
        null, null, null);
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
        null,
        null,
        null,
        null,
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
        null,
        null,
        null,
        null,
        null,
        null);
  }

  /** Pre-HU-69 shape (no birthday / acquisition channel). */
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
      String identityDocumentType,
      String taxpayerType) {
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
        taxpayerType,
        null,
        null,
        null,
        null,
        null);
  }
}
