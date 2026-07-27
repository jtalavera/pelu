package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.config.SifenCertificateProperties;
import org.junit.jupiter.api.Test;

class SifenCertificateEncryptionServiceTest {

  private final SifenCertificateEncryptionService service = newService();

  private static SifenCertificateEncryptionService newService() {
    SifenCertificateProperties props = new SifenCertificateProperties();
    props.setCertEncryptionKey("enOvRBV4YK7cD2WVPl0pMOLFRq5xGVCnGBNLse2/XUY=");
    return new SifenCertificateEncryptionService(props);
  }

  @Test
  void roundTrip_bytes_recoversOriginal() {
    byte[] original = "hello sifen".getBytes();
    String encrypted = service.encrypt(original);
    assertThat(service.decryptToBytes(encrypted)).isEqualTo(original);
  }

  @Test
  void roundTrip_string_recoversOriginal() {
    String encrypted = service.encrypt("TestPass123!");
    assertThat(service.decryptToString(encrypted)).isEqualTo("TestPass123!");
  }

  @Test
  void encrypt_isNeverPlaintextAndVariesPerCall() {
    String plaintext = "super-secret-password";
    String first = service.encrypt(plaintext);
    String second = service.encrypt(plaintext);
    assertThat(first).doesNotContain(plaintext);
    assertThat(second).doesNotContain(plaintext);
    assertThat(first).isNotEqualTo(second);
  }
}
