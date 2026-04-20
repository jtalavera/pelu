package com.cursorpoc.backend.service;

import com.azure.communication.email.EmailClient;
import com.azure.communication.email.EmailClientBuilder;
import com.azure.communication.email.models.EmailAddress;
import com.azure.communication.email.models.EmailMessage;
import java.util.Locale;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.MessageSource;
import org.springframework.stereotype.Service;

@Service
public class EmailService {

  private static final Logger log = LoggerFactory.getLogger(EmailService.class);

  @Value("${app.femme.email.enabled:false}")
  private boolean enabled;

  @Value("${app.femme.email.connection-string:}")
  private String connectionString;

  @Value("${app.femme.email.sender-address:}")
  private String senderAddress;

  private final MessageSource messageSource;

  public EmailService(MessageSource messageSource) {
    this.messageSource = messageSource;
  }

  public void sendActivationLink(String toEmail, String activationUrl, Locale locale) {
    String subject = messageSource.getMessage("email.activation.subject", null, locale);
    String body =
        messageSource.getMessage("email.activation.body", new Object[] {activationUrl}, locale);

    if (!enabled) {
      log.info(
          "EMAIL (dev) from={} to={} subject=\"{}\" body=\"{}\"",
          senderAddress.isBlank() ? "no-sender-configured" : senderAddress,
          toEmail,
          subject,
          body);
      return;
    }

    EmailClient client = new EmailClientBuilder().connectionString(connectionString).buildClient();
    EmailMessage message =
        new EmailMessage()
            .setSenderAddress(senderAddress)
            .setToRecipients(new EmailAddress(toEmail))
            .setSubject(subject)
            .setBodyPlainText(body);
    client.beginSend(message).getFinalResult();
    log.info(
        "EMAIL SENT from={} to={} subject=\"{}\" locale={}",
        senderAddress,
        toEmail,
        subject,
        locale.getLanguage());
  }
}
