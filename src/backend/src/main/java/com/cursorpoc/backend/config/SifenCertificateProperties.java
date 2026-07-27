package com.cursorpoc.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.femme.sifen")
public class SifenCertificateProperties {

  /**
   * Base64-encoded 256-bit AES key used to encrypt certificate .p12 bytes and passwords at rest.
   */
  private String certEncryptionKey = "change-me";

  public String getCertEncryptionKey() {
    return certEncryptionKey;
  }

  public void setCertEncryptionKey(String certEncryptionKey) {
    this.certEncryptionKey = certEncryptionKey;
  }
}
