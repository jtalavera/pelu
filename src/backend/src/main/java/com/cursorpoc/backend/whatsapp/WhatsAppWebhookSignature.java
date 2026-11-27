package com.cursorpoc.backend.whatsapp;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Meta signs every webhook POST: header {@code X-Hub-Signature-256: sha256=<hex>}, an HMAC-SHA256
 * of the raw, unmodified body keyed with the app secret (HU-WAP-06, criterio 1). Compared in
 * constant time. A blank secret never validates anything.
 */
public final class WhatsAppWebhookSignature {

  private static final String PREFIX = "sha256=";

  private WhatsAppWebhookSignature() {}

  public static boolean isValid(byte[] rawBody, String header, String appSecret) {
    if (rawBody == null
        || header == null
        || !header.startsWith(PREFIX)
        || appSecret == null
        || appSecret.isBlank()) {
      return false;
    }
    byte[] expected = sign(rawBody, appSecret).getBytes(StandardCharsets.UTF_8);
    byte[] given =
        header.substring(PREFIX.length()).trim().toLowerCase().getBytes(StandardCharsets.UTF_8);
    return MessageDigest.isEqual(expected, given);
  }

  /** {@code sha256=<hex>} for a body — what Meta (and the e2e tests) send. */
  public static String header(byte[] rawBody, String appSecret) {
    return PREFIX + sign(rawBody, appSecret);
  }

  private static String sign(byte[] body, String secret) {
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
      byte[] digest = mac.doFinal(body);
      StringBuilder sb = new StringBuilder(digest.length * 2);
      for (byte b : digest) {
        sb.append(String.format("%02x", b));
      }
      return sb.toString();
    } catch (java.security.GeneralSecurityException ex) {
      throw new IllegalStateException(ex);
    }
  }
}
