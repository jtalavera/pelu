package com.cursorpoc.backend.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.cursorpoc.backend.whatsapp.WhatsAppSettings;
import com.cursorpoc.backend.whatsapp.WhatsAppWebhookProcessor;
import com.cursorpoc.backend.whatsapp.WhatsAppWebhookSignature;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * Issue #224 AC: "the webhook verification endpoint correctly responds to Meta's challenge." Direct
 * unit tests against the controller — same lightweight style as {@code
 * SifenEnvironmentControllerTest} (no MockMvc/Spring context needed for this much logic).
 */
class WhatsAppWebhookControllerTest {

  private static final String APP_SECRET = "test-app-secret";

  private final WhatsAppWebhookProcessor processor = mock(WhatsAppWebhookProcessor.class);

  private WhatsAppWebhookController newController(String configuredVerifyToken) {
    WhatsAppSettings settings =
        new WhatsAppSettings(
            true, "fake", "", "", "", APP_SECRET, configuredVerifyToken, "v21.0", "", 1, 1, 1);
    return new WhatsAppWebhookController(settings, processor);
  }

  private static byte[] bytes(String s) {
    return s.getBytes(StandardCharsets.UTF_8);
  }

  @Test
  void verify_correctModeAndToken_echoesChallengeWith200() {
    WhatsAppWebhookController controller = newController("s3cr3t-verify-token");

    ResponseEntity<String> response =
        controller.verify("subscribe", "s3cr3t-verify-token", "challenge-abc-123");

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getBody()).isEqualTo("challenge-abc-123");
  }

  @Test
  void verify_wrongToken_isForbidden() {
    WhatsAppWebhookController controller = newController("s3cr3t-verify-token");

    ResponseEntity<String> response =
        controller.verify("subscribe", "wrong-token", "challenge-abc-123");

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(response.getBody()).isNull();
  }

  @Test
  void verify_missingToken_isForbidden() {
    WhatsAppWebhookController controller = newController("s3cr3t-verify-token");

    ResponseEntity<String> response = controller.verify("subscribe", null, "challenge-abc-123");

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
  }

  @Test
  void verify_wrongMode_isForbidden() {
    WhatsAppWebhookController controller = newController("s3cr3t-verify-token");

    ResponseEntity<String> response =
        controller.verify("unsubscribe", "s3cr3t-verify-token", "challenge-abc-123");

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
  }

  /**
   * No configured secret (the default, {@code app.femme.whatsapp.webhook-verify-token="""} when
   * WHATSAPP_WEBHOOK_VERIFY_TOKEN isn't set) must never echo a challenge — even a request that
   * "matches" a blank token both ways is rejected, so a misconfigured/unconfigured deployment fails
   * closed rather than open.
   */
  @Test
  void verify_noSecretConfigured_isForbiddenEvenIfTokenIsAlsoBlank() {
    WhatsAppWebhookController controller = newController("");

    ResponseEntity<String> response = controller.verify("subscribe", "", "challenge-abc-123");

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
  }

  @Test
  void receiveCallback_validSignature_isProcessedAndAcknowledged() {
    WhatsAppWebhookController controller = newController("s3cr3t-verify-token");
    byte[] body = bytes("{\"entry\":[{\"changes\":[{\"value\":{\"statuses\":[]}}]}]}");

    ResponseEntity<Void> response =
        controller.receiveCallback(body, WhatsAppWebhookSignature.header(body, APP_SECRET));

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    verify(processor).process(body);
  }

  @Test
  void receiveCallback_invalidSignature_isForbiddenAndNotProcessed() {
    WhatsAppWebhookController controller = newController("s3cr3t-verify-token");
    byte[] body = bytes("{\"entry\":[]}");

    ResponseEntity<Void> response =
        controller.receiveCallback(body, WhatsAppWebhookSignature.header(body, "other-secret"));

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    verify(processor, never()).process(any());
  }

  @Test
  void receiveCallback_tamperedBody_isForbidden() {
    WhatsAppWebhookController controller = newController("s3cr3t-verify-token");
    byte[] signed = bytes("{\"entry\":[]}");
    String header = WhatsAppWebhookSignature.header(signed, APP_SECRET);

    ResponseEntity<Void> response = controller.receiveCallback(bytes("{\"entry\": []}"), header);

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    verify(processor, never()).process(any());
  }

  @Test
  void receiveCallback_missingSignature_isForbidden() {
    WhatsAppWebhookController controller = newController("s3cr3t-verify-token");

    ResponseEntity<Void> response = controller.receiveCallback(bytes("{}"), null);

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    verify(processor, never()).process(any());
  }

  @Test
  void receiveCallback_nullBody_isForbidden() {
    WhatsAppWebhookController controller = newController("s3cr3t-verify-token");

    ResponseEntity<Void> response = controller.receiveCallback(null, "sha256=abc");

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
  }

  @Test
  void receiveCallback_noAppSecretConfigured_rejectsEvenAMatchingLookingSignature() {
    WhatsAppSettings noSecret =
        new WhatsAppSettings(true, "fake", "", "", "", "", "t", "v21.0", "", 1, 1, 1);
    WhatsAppWebhookController controller = new WhatsAppWebhookController(noSecret, processor);
    byte[] body = bytes("{}");

    ResponseEntity<Void> response =
        controller.receiveCallback(body, WhatsAppWebhookSignature.header(body, "x"));

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
  }
}
