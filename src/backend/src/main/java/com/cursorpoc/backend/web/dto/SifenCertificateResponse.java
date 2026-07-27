package com.cursorpoc.backend.web.dto;

import java.time.Instant;
import java.time.LocalDate;

/** Never includes the private key, the .p12 file, or the keystore password (HU-18 AC-06). */
public record SifenCertificateResponse(
    long id, Instant uploadedAt, LocalDate notBefore, LocalDate notAfter) {}
