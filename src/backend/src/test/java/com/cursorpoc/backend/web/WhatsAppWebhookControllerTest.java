package com.cursorpoc.backend.web;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * Issue #224 AC: "the webhook verification endpoint correctly responds to Meta's challenge." Direct
 * unit tests against the controller — same lightweight style as {@code
 * SifenEnvironmentControllerTest} (no MockMvc/Spring context needed for this much logic).
 */
class WhatsAppWebhookControllerTest {

  private WhatsAppWebhookController newController(String configuredVerifyToken) {
    WhatsAppWebhookController controller = new WhatsAppWebhookController();
    ReflectionTestUtils.setField(controller, "verifyToken", configuredVerifyToken);
    return controller;
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
  void receiveCallback_acknowledgesWith200() {
    WhatsAppWebhookController controller = newController("s3cr3t-verify-token");

    ResponseEntity<Void> response =
        controller.receiveCallback(
            "{\"entry\":[{\"changes\":[{\"value\":{\"statuses\":[{\"status\":\"delivered\"}]}}]}]}");

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
  }

  @Test
  void receiveCallback_nullBody_stillAcknowledgesWith200() {
    WhatsAppWebhookController controller = newController("s3cr3t-verify-token");

    ResponseEntity<Void> response = controller.receiveCallback(null);

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
  }
}
