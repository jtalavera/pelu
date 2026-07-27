package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.SifenCertificateProperties;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Service;

/**
 * AES-256-GCM encryption at rest for SIFEN certificate material (HU-18 AC-06: the private key and
 * keystore password must never be recoverable from the database alone). Each call generates a fresh
 * random nonce, stored alongside the ciphertext as {@code base64(nonce || ciphertext+tag)}.
 */
@Service
public class SifenCertificateEncryptionService {

  private static final String TRANSFORMATION = "AES/GCM/NoPadding";
  private static final int GCM_NONCE_LENGTH_BYTES = 12;
  private static final int GCM_TAG_LENGTH_BITS = 128;

  private final SecretKeySpec key;
  private final SecureRandom secureRandom = new SecureRandom();

  public SifenCertificateEncryptionService(SifenCertificateProperties properties) {
    byte[] keyBytes = Base64.getDecoder().decode(properties.getCertEncryptionKey());
    this.key = new SecretKeySpec(keyBytes, "AES");
  }

  public String encrypt(byte[] plaintext) {
    try {
      byte[] nonce = new byte[GCM_NONCE_LENGTH_BYTES];
      secureRandom.nextBytes(nonce);
      Cipher cipher = Cipher.getInstance(TRANSFORMATION);
      cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_LENGTH_BITS, nonce));
      byte[] ciphertext = cipher.doFinal(plaintext);
      byte[] combined = new byte[nonce.length + ciphertext.length];
      System.arraycopy(nonce, 0, combined, 0, nonce.length);
      System.arraycopy(ciphertext, 0, combined, nonce.length, ciphertext.length);
      return Base64.getEncoder().encodeToString(combined);
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException("Failed to encrypt SIFEN certificate material", e);
    }
  }

  public String encrypt(String plaintext) {
    return encrypt(plaintext.getBytes(StandardCharsets.UTF_8));
  }

  public byte[] decryptToBytes(String encryptedBase64) {
    try {
      byte[] combined = Base64.getDecoder().decode(encryptedBase64);
      byte[] nonce = new byte[GCM_NONCE_LENGTH_BYTES];
      System.arraycopy(combined, 0, nonce, 0, nonce.length);
      Cipher cipher = Cipher.getInstance(TRANSFORMATION);
      cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_LENGTH_BITS, nonce));
      return cipher.doFinal(combined, nonce.length, combined.length - nonce.length);
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException("Failed to decrypt SIFEN certificate material", e);
    }
  }

  public String decryptToString(String encryptedBase64) {
    return new String(decryptToBytes(encryptedBase64), StandardCharsets.UTF_8);
  }
}
