package com.cursorpoc.backend.web.dto;

public record ClientResponse(
    long id,
    String fullName,
    String phone,
    String email,
    String ruc,
    boolean active,
    int visitCount,
    String identityDocumentNumber,
    String address,
    String departmentCode,
    String departmentName,
    String cityCode,
    String cityName,
    /** Nombre de {@link com.cursorpoc.backend.domain.enums.ClientIdentityDocumentType}, o null. */
    String identityDocumentType,
    /** Nombre de {@link com.cursorpoc.backend.domain.enums.ClientTaxpayerType}, o null. */
    String taxpayerType,
    /** HU-69: birthday (day + month, optional year) and "¿cómo nos conoció?". */
    Integer birthdayDay,
    Integer birthdayMonth,
    Integer birthdayYear,
    String acquisitionChannel,
    String acquisitionChannelOther,
    /** Last CLOSED service record (same rule as the visit count), ISO instant, or null. */
    String lastVisitAt,
    /** HU-WAP-03: consent to WhatsApp notices (valid for the current phone). */
    boolean whatsappOptIn,
    String whatsappOptInAt,
    /** ONLINE_BOOKING, STAFF, EMAIL_LINK or REPLY. */
    String whatsappOptInSource) {

  /** Without the WhatsApp consent fields (professional view, tests): no consent. */
  public ClientResponse(
      long id,
      String fullName,
      String phone,
      String email,
      String ruc,
      boolean active,
      int visitCount,
      String identityDocumentNumber,
      String address,
      String departmentCode,
      String departmentName,
      String cityCode,
      String cityName,
      String identityDocumentType,
      String taxpayerType,
      Integer birthdayDay,
      Integer birthdayMonth,
      Integer birthdayYear,
      String acquisitionChannel,
      String acquisitionChannelOther,
      String lastVisitAt) {
    this(
        id,
        fullName,
        phone,
        email,
        ruc,
        active,
        visitCount,
        identityDocumentNumber,
        address,
        departmentCode,
        departmentName,
        cityCode,
        cityName,
        identityDocumentType,
        taxpayerType,
        birthdayDay,
        birthdayMonth,
        birthdayYear,
        acquisitionChannel,
        acquisitionChannelOther,
        lastVisitAt,
        false,
        null,
        null);
  }
}
