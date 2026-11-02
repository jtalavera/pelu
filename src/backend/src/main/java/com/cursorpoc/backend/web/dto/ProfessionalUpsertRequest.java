package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotBlank;

public record ProfessionalUpsertRequest(
    @NotBlank String fullName,
    String phone,
    String email,
    String photoDataUrl,
    String pin,
    Boolean systemAccessAllowed,
    /** Optional nickname (max 60 chars); blank clears it. */
    String nickname) {

  public ProfessionalUpsertRequest(
      String fullName,
      String phone,
      String email,
      String photoDataUrl,
      String pin,
      Boolean systemAccessAllowed) {
    this(fullName, phone, email, photoDataUrl, pin, systemAccessAllowed, null);
  }
}
