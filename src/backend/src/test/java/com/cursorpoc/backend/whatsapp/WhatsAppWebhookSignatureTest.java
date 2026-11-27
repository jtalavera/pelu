package com.cursorpoc.backend.whatsapp;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

class WhatsAppWebhookSignatureTest {

  private static final byte[] BODY = "{\"entry\":[]}".getBytes(StandardCharsets.UTF_8);

  @Test
  void validSignature_isAccepted() {
    String header = WhatsAppWebhookSignature.header(BODY, "secret");
    assertThat(header).startsWith("sha256=");
    assertThat(WhatsAppWebhookSignature.isValid(BODY, header, "secret")).isTrue();
  }

  /** Reference vector, computed independently: HMAC-SHA256("key", "The quick brown fox..."). */
  @Test
  void matchesTheKnownHmacSha256Vector() {
    byte[] msg = "The quick brown fox jumps over the lazy dog".getBytes(StandardCharsets.UTF_8);
    assertThat(WhatsAppWebhookSignature.header(msg, "key"))
        .isEqualTo("sha256=f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  }

  @Test
  void wrongSecretTamperedBodyOrBadHeader_areRejected() {
    String header = WhatsAppWebhookSignature.header(BODY, "secret");
    assertThat(WhatsAppWebhookSignature.isValid(BODY, header, "other")).isFalse();
    assertThat(
            WhatsAppWebhookSignature.isValid(
                "{}".getBytes(StandardCharsets.UTF_8), header, "secret"))
        .isFalse();
    assertThat(WhatsAppWebhookSignature.isValid(BODY, null, "secret")).isFalse();
    assertThat(WhatsAppWebhookSignature.isValid(BODY, "", "secret")).isFalse();
    assertThat(WhatsAppWebhookSignature.isValid(BODY, "sha1=abc", "secret")).isFalse();
    assertThat(WhatsAppWebhookSignature.isValid(BODY, "sha256=", "secret")).isFalse();
    assertThat(WhatsAppWebhookSignature.isValid(null, header, "secret")).isFalse();
  }

  @Test
  void blankSecret_neverValidates() {
    String header = WhatsAppWebhookSignature.header(BODY, "x");
    assertThat(WhatsAppWebhookSignature.isValid(BODY, header, "")).isFalse();
    assertThat(WhatsAppWebhookSignature.isValid(BODY, header, null)).isFalse();
  }
}
