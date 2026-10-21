package com.cursorpoc.backend.security;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;

/** HU-66: the shared-device credential — sent by the device in a header, stored only hashed. */
public final class DeviceTokens {

  /** Header a shared device sends its credential in (PIN picker, PIN login, PIN sessions). */
  public static final String HEADER = "X-Femme-Device";

  private static final SecureRandom RANDOM = new SecureRandom();

  private DeviceTokens() {}

  public static String newRawToken() {
    byte[] bytes = new byte[32];
    RANDOM.nextBytes(bytes);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
  }

  public static String hash(String rawToken) {
    try {
      MessageDigest md = MessageDigest.getInstance("SHA-256");
      return HexFormat.of().formatHex(md.digest(rawToken.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }
}
