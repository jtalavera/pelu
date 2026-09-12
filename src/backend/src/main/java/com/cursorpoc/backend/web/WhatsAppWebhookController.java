package com.cursorpoc.backend.web;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Issue #224: Meta WhatsApp Cloud API webhook — verification challenge ({@code GET}) plus
 * delivery-status callbacks ({@code POST}). Both routes are {@code permitAll} in {@link
 * com.cursorpoc.backend.config.SecurityConfig} — Meta calls this endpoint directly, with no JWT to
 * present, exactly like {@code /health} or {@code /api/auth/**}.
 *
 * <p><b>Tenant-ID logging judgment call:</b> every other controller in this codebase logs {@code
 * tenantId} on request/response because it comes from an authenticated {@link
 * com.cursorpoc.backend.security.FemmeUserPrincipal}. Meta's webhook has no such principal — this
 * base integration also has no per-tenant WhatsApp number mapping yet (a single Cloud API
 * phone-number-id/WABA is configured app-wide), so there is no tenant to attribute the call to. Log
 * lines below say {@code tenantId=n/a} explicitly instead of a silently absent field, so a log scan
 * for "tenantId=" still finds an intentional value here rather than a gap.
 *
 * <p><b>Verify-token security:</b> per Meta's Cloud API webhook spec, the {@code GET} verification
 * request carries {@code hub.mode=subscribe&hub.verify_token=<secret>&hub.challenge=<token>}, and
 * the receiver must echo back {@code hub.challenge} ONLY if {@code hub.verify_token} matches a
 * secret configured out-of-band in the Meta App Dashboard when the webhook subscription is set up —
 * never unconditionally. {@code app.femme.whatsapp.webhook-verify-token} (env var {@code
 * WHATSAPP_WEBHOOK_VERIFY_TOKEN}) holds that shared secret; it defaults to blank, which makes
 * {@link #verify} always answer 403 rather than ever echoing a challenge with no real check
 * configured.
 */
@RestController
@RequestMapping("/api/whatsapp/webhook")
public class WhatsAppWebhookController {

  private static final Logger log = LoggerFactory.getLogger(WhatsAppWebhookController.class);

  @Value("${app.femme.whatsapp.webhook-verify-token:}")
  private String verifyToken;

  @GetMapping
  public ResponseEntity<String> verify(
      @RequestParam(name = "hub.mode", required = false) String mode,
      @RequestParam(name = "hub.verify_token", required = false) String token,
      @RequestParam(name = "hub.challenge", required = false) String challenge) {
    log.info(
        "GET /api/whatsapp/webhook method=GET tenantId=n/a (Meta webhook, unauthenticated)"
            + " hubMode={}",
        mode);

    boolean verified =
        "subscribe".equals(mode)
            && verifyToken != null
            && !verifyToken.isBlank()
            && verifyToken.equals(token);
    if (!verified) {
      log.error("GET /api/whatsapp/webhook tenantId=n/a status=403 reason=VERIFY_TOKEN_MISMATCH");
      return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
    }

    log.info("GET /api/whatsapp/webhook tenantId=n/a status=200 challengeEchoed=true");
    return ResponseEntity.ok(challenge);
  }

  /**
   * Delivery-status / message callbacks. No processing required for this issue — just acknowledge
   * with 200 so Meta doesn't retry/disable the subscription. Logs the payload length rather than
   * its raw content: callback bodies can carry recipient phone numbers and message content, and
   * this base integration has no use for the content yet — same "log size, not content" choice
   * {@link com.cursorpoc.backend.service.SifenEventClient} makes for its outbound request line.
   */
  @PostMapping
  public ResponseEntity<Void> receiveCallback(@RequestBody(required = false) String payload) {
    int payloadLength = payload == null ? 0 : payload.length();
    log.info(
        "POST /api/whatsapp/webhook method=POST tenantId=n/a (Meta webhook, unauthenticated)"
            + " payloadChars={}",
        payloadLength);
    log.info("POST /api/whatsapp/webhook tenantId=n/a status=200");
    return ResponseEntity.ok().build();
  }
}
