package com.cursorpoc.backend.whatsapp;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Optional;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * HU-WAP-06 criterio 3: the payload a reply button carries is SIGNED ({@code
 * v1.<ACTION>.<turno>.<firma>}), so what comes back from a client is only believed after the server
 * verifies it; tenant and turno are then read from the turno itself, never from what the client
 * says. The key is {@code app.femme.whatsapp.payload-secret}; when it is not set, one is derived
 * from the app secret (still never the app secret itself).
 */
@Component
public class WhatsAppPayloads {

  public enum Action {
    /** «Confirmo» */
    CONFIRM,
    /** «No puedo ir» */
    CANT_GO,
    /** «Sí, cancelar» */
    CANCEL_YES,
    /** «No, mantener» */
    CANCEL_NO
  }

  public record Parsed(Action action, long appointmentId) {}

  private static final String VERSION = "v1";
  private static final int SIGNATURE_BYTES = 12;

  private final byte[] key;
  private final boolean available;

  public WhatsAppPayloads(
      @Value("${app.femme.whatsapp.payload-secret:}") String payloadSecret,
      WhatsAppSettings settings) {
    boolean ownKey = payloadSecret != null && !payloadSecret.isBlank();
    this.available = ownKey || !settings.getAppSecret().isBlank();
    String material = ownKey ? payloadSecret : "payload-key:" + settings.getAppSecret();
    this.key = material.getBytes(StandardCharsets.UTF_8);
  }

  /** Whether buttons can be signed at all (some secret is configured). */
  public boolean isAvailable() {
    return available;
  }

  public String sign(Action action, long appointmentId) {
    String body = VERSION + "." + action.name() + "." + appointmentId;
    return body + "." + signature(body);
  }

  /** The action and turno of a payload with a valid signature; empty for anything else. */
  public Optional<Parsed> verify(String payload) {
    if (payload == null || payload.length() > 200) {
      return Optional.empty();
    }
    String[] parts = payload.split("\\.", -1);
    if (parts.length != 4 || !VERSION.equals(parts[0])) {
      return Optional.empty();
    }
    String body = parts[0] + "." + parts[1] + "." + parts[2];
    byte[] expected = signature(body).getBytes(StandardCharsets.US_ASCII);
    byte[] given = parts[3].getBytes(StandardCharsets.US_ASCII);
    if (!MessageDigest.isEqual(expected, given)) {
      return Optional.empty();
    }
    try {
      return Optional.of(new Parsed(Action.valueOf(parts[1]), Long.parseLong(parts[2])));
    } catch (IllegalArgumentException ex) {
      return Optional.empty();
    }
  }

  private String signature(String body) {
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(key.length == 0 ? new byte[] {0} : key, "HmacSHA256"));
      byte[] full = mac.doFinal(body.getBytes(StandardCharsets.UTF_8));
      StringBuilder sb = new StringBuilder();
      for (int i = 0; i < SIGNATURE_BYTES; i++) {
        sb.append(String.format("%02x", full[i]));
      }
      return sb.toString();
    } catch (java.security.GeneralSecurityException ex) {
      throw new IllegalStateException(ex);
    }
  }
}
