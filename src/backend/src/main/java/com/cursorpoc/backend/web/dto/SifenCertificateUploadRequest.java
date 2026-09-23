package com.cursorpoc.backend.web.dto;

import jakarta.validation.constraints.NotBlank;

/** {@code fileBase64} is the raw .p12 file bytes, base64-encoded (no data: URI prefix). */
public record SifenCertificateUploadRequest(
    @NotBlank String fileBase64, @NotBlank String password) {}
