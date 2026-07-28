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
    String department,
    String city) {

  public ClientRequest(String fullName, String phone, String email, String ruc) {
    this(fullName, phone, email, ruc, null, null, null, null);
  }
}
