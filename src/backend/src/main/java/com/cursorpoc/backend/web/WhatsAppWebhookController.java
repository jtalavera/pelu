package com.cursorpoc.backend.web;

import com.cursorpoc.backend.whatsapp.WhatsAppSettings;
import com.cursorpoc.backend.whatsapp.WhatsAppWebhookProcessor;
import com.cursorpoc.backend.whatsapp.WhatsAppWebhookSignature;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Issue #224: Meta WhatsApp Cloud API webhook — verification challenge ({@code GET}) plus
 * delivery-status callbacks ({@code POST}). Both routes are {@code permitAll} in {@link
 * com.cursorpoc.backend.config.SecurityConfig} — Meta calls this endpoint directly, with no JWT to
 * present, exactly like {@code /health} or {@code /api/auth/**}.
 *
 * <p><b>Tenant-ID logging:</b> every other controller logs {@code tenantId} from an authenticated
 * principal. Meta's webhook has none, and the single shared number serves every salon, so the
 * request itself has no tenant: the log lines say {@code tenantId=n/a}. Events that can be tied to
 * a salon (HU-WAP-06/07) derive the tenant from signed data inside the processor, never from the
 * request.
 *
 * <p><b>Verify-token security:</b> per Meta's Cloud API webhook spec, the {@code GET} verification
 * request carries {@code hub.mode=subscribe&hub.verify_token=<secret>&hub.challenge=<token>}, and
 * the receiver must echo back {@code hub.challenge} ONLY if {@code hub.verify_token} matches a
 * secret configured out-of-band in the Meta App Dashboard when the webhook subscription is set up —
 * never unconditionally. {@code app.femme.whatsapp.webhook-verify-token} (env var {@code
 * WHATSAPP_WEBHOOK_VERIFY_TOKEN}) holds that shared secret; it defaults to blank, which makes
 * {@link #verify} always answer 403 rather than ever echoing a challenge with no real check
 * configured. The comparison itself uses {@link MessageDigest#isEqual} rather than {@code
 * String.equals} for a constant-time check.
 */
@RestController
@RequestMapping("/api/whatsapp/webhook")
public class WhatsAppWebhookController {

  private static final Logger log = LoggerFactory.getLogger(WhatsAppWebhookController.class);

  private final WhatsAppSettings settings;
  private final WhatsAppWebhookProcessor processor;

  public WhatsAppWebhookController(WhatsAppSettings settings, WhatsAppWebhookProcessor processor) {
    this.settings = settings;
    this.processor = processor;
  }

  @GetMapping
  public ResponseEntity<String> verify(
      @RequestParam(name = "hub.mode", required = false) String mode,
      @RequestParam(name = "hub.verify_token", required = false) String token,
      @RequestParam(name = "hub.challenge", required = false) String challenge) {
    log.info(
        "GET /api/whatsapp/webhook method=GET tenantId=n/a (Meta webhook, unauthenticated)"
            + " hubMode={}",
        mode);

    // Constant-time comparison (MessageDigest.isEqual) rather than String.equals, which
    // short-circuits on the first mismatched byte — low real-world exposure for a webhook setup
    // secret, but cheap to close off.
    String verifyToken = settings.getVerifyToken();
    boolean verified =
        "subscribe".equals(mode)
            && verifyToken != null
            && !verifyToken.isBlank()
            && token != null
            && MessageDigest.isEqual(
                token.getBytes(StandardCharsets.UTF_8),
                verifyToken.getBytes(StandardCharsets.UTF_8));
    if (!verified) {
      log.error("GET /api/whatsapp/webhook tenantId=n/a status=403 reason=VERIFY_TOKEN_MISMATCH");
      return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
    }

    log.info("GET /api/whatsapp/webhook tenantId=n/a status=200 challengeEchoed=true");
    return ResponseEntity.ok(challenge);
  }

  /**
   * Meta's notifications. HU-WAP-06 (criterio 1): the body is authenticated with {@code
   * X-Hub-Signature-256} (HMAC-SHA256 of the raw body with the app secret) BEFORE anything is read
   * from it; a missing or invalid signature answers 403 and the content is neither processed nor
   * logged. A valid one is acknowledged with 200 even if processing fails, so Meta does not retry
   * forever (the processor logs its own errors). Only the payload size is logged (RT-13).
   */
  @PostMapping
  public ResponseEntity<Void> receiveCallback(
      @RequestBody(required = false) byte[] payload,
      @RequestHeader(name = "X-Hub-Signature-256", required = false) String signature) {
    if (!WhatsAppWebhookSignature.isValid(payload, signature, settings.getAppSecret())) {
      log.error("POST /api/whatsapp/webhook tenantId=n/a status=403 reason=INVALID_SIGNATURE");
      return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
    }
    log.info(
        "POST /api/whatsapp/webhook method=POST tenantId=n/a (Meta webhook, signed) payloadBytes={}",
        payload.length);
    processor.process(payload);
    log.info("POST /api/whatsapp/webhook tenantId=n/a status=200");
    return ResponseEntity.ok().build();
  }
}
