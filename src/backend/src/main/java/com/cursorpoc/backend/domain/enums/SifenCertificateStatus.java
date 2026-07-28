package com.cursorpoc.backend.domain.enums;

/** HU-20: computed on read from {@code notBefore}/{@code notAfter}, never persisted. */
public enum SifenCertificateStatus {
  VALID,
  EXPIRED,
  NOT_YET_VALID
}
