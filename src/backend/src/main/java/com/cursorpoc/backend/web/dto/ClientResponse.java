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
    String identityDocumentType) {}
