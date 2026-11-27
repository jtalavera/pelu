package com.cursorpoc.backend.whatsapp;

import com.cursorpoc.backend.util.PhoneNumberNormalizer;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * The SYNCHRONOUS send mode (HU-WAP-01, criterio 3): used for the verification code, where the
 * client is waiting, with a short timeout and no retry queue. The caller decides what to do on a
 * {@link WhatsAppSendException} (the booking offers email). Also the platform's test send.
 */
@Service
public class WhatsAppSender {

  private static final Logger log = LoggerFactory.getLogger(WhatsAppSender.class);

  private final WhatsAppGateway gateway;
  private final WhatsAppAccess access;
  private final WhatsAppTemplateStatusService templateStatus;
  private final WhatsAppMessageStore store;
  private final WhatsAppSettings settings;

  public WhatsAppSender(
      WhatsAppGateway gateway,
      WhatsAppAccess access,
      WhatsAppTemplateStatusService templateStatus,
      WhatsAppMessageStore store,
      WhatsAppSettings settings) {
    this.gateway = gateway;
    this.access = access;
    this.templateStatus = templateStatus;
    this.store = store;
    this.settings = settings;
  }

  /** Sends the verification code of a salon's booking page and records it (without the code). */
  public WhatsAppSendResult sendVerificationCode(long tenantId, String toPhone, String code) {
    String to =
        PhoneNumberNormalizer.normalize(toPhone)
            .orElseThrow(() -> new WhatsAppSendException(WhatsAppErrorCode.INVALID_RECIPIENT));
    String template = WhatsAppTemplate.CODIGO_VERIFICACION.templateName();
    try {
      access.requireAvailable(tenantId);
      requireApproved(WhatsAppTemplate.CODIGO_VERIFICACION);
      WhatsAppOutboundMessage message =
          WhatsAppTemplate.CODIGO_VERIFICACION.message(
              to, java.util.List.of(code), java.util.List.of(WhatsAppButton.url(0, code)));
      WhatsAppSendResult result =
          gateway.send(message, Duration.ofMillis(settings.getOtpTimeoutMs()));
      store.recordImmediate(tenantId, "OTP", template, to, result.wamid(), null);
      return result;
    } catch (WhatsAppSendException ex) {
      store.recordImmediate(tenantId, "OTP", template, to, null, ex.getCode().name());
      log.error(
          "WHATSAPP otp failed tenantId={} to={} error={}",
          tenantId,
          PhoneNumberNormalizer.mask(to),
          ex.getCode());
      throw ex;
    }
  }

  /**
   * Platform test send (no salon, nothing recorded): a catalog template filled with the example
   * values of the Meta submission. Needs the channel operational, not any salon's flags.
   */
  public WhatsAppSendResult sendPlatformTest(String toPhone, WhatsAppTemplate template) {
    String to =
        PhoneNumberNormalizer.normalize(toPhone)
            .orElseThrow(() -> new WhatsAppSendException(WhatsAppErrorCode.INVALID_RECIPIENT));
    if (!settings.isOperational()) {
      throw new WhatsAppSendException(WhatsAppErrorCode.CHANNEL_UNAVAILABLE);
    }
    requireApproved(template);
    WhatsAppOutboundMessage message = exampleMessage(to, template);
    log.info(
        "WHATSAPP platform test to={} template={}",
        PhoneNumberNormalizer.mask(to),
        template.templateName());
    return gateway.send(message, Duration.ofMillis(settings.getRequestTimeoutMs()));
  }

  private void requireApproved(WhatsAppTemplate template) {
    if (!templateStatus.isUsable(template.templateName(), WhatsAppTemplate.LANGUAGE)) {
      throw new WhatsAppSendException(WhatsAppErrorCode.TEMPLATE_UNAVAILABLE);
    }
  }

  /** The example values suggested for Meta's "Sample" fields, plus example button values. */
  static WhatsAppOutboundMessage exampleMessage(String to, WhatsAppTemplate template) {
    java.util.List<String> samples =
        java.util.List.of(
            "María", "Salón Bella", "Corte y brushing", "viernes 28/11", "15:30", "Laura");
    java.util.List<String> variables;
    java.util.List<WhatsAppButton> buttons = new java.util.ArrayList<>();
    if (template == WhatsAppTemplate.CODIGO_VERIFICACION) {
      variables = java.util.List.of("482915");
      buttons.add(WhatsAppButton.url(0, "482915"));
    } else {
      variables = samples.subList(0, template.bodyVariables());
      for (int i = 0; i < template.buttons().size(); i++) {
        WhatsAppTemplate.ButtonSpec spec = template.buttons().get(i);
        if (spec.kind() == WhatsAppButton.Kind.URL) {
          boolean slugOnly =
              template == WhatsAppTemplate.TURNO_NO_DISPONIBLE
                  || template == WhatsAppTemplate.TURNO_CANCELADO;
          buttons.add(WhatsAppButton.url(i, slugOnly ? "bella" : "bella/turno/abc123"));
        } else {
          buttons.add(WhatsAppButton.quickReply(i, "test:" + i));
        }
      }
    }
    return template.message(to, variables, buttons);
  }
}
