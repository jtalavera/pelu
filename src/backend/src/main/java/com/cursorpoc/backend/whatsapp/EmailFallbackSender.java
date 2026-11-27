package com.cursorpoc.backend.whatsapp;

import com.cursorpoc.backend.service.EmailService;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/** Production sender: the platform's {@link EmailService}. */
@Component
@ConditionalOnProperty(
    name = "app.femme.whatsapp.provider",
    havingValue = WhatsAppSettings.PROVIDER_META,
    matchIfMissing = true)
public class EmailFallbackSender implements FallbackEmailSender {

  private final EmailService emailService;

  public EmailFallbackSender(EmailService emailService) {
    this.emailService = emailService;
  }

  @Override
  public void send(String toEmail, String subject, String body) {
    emailService.sendPlainTextEmail(toEmail, subject, body);
  }
}
