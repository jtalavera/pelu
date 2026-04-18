package com.cursorpoc.backend.service;

import com.azure.communication.email.EmailClient;
import com.azure.communication.email.EmailClientBuilder;
import com.azure.communication.email.models.EmailAddress;
import com.azure.communication.email.models.EmailMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
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

  public void sendActivationLink(String toEmail, String activationUrl) {
    if (!enabled) {
      log.info("professional activation link (dev): {} (email: {})", activationUrl, toEmail);
      return;
    }
    EmailClient client =
        new EmailClientBuilder().connectionString(connectionString).buildClient();
    EmailMessage message =
        new EmailMessage()
            .setSenderAddress(senderAddress)
            .setToRecipients(new EmailAddress(toEmail))
            .setSubject("Activate your Femme account")
            .setBodyPlainText(
                "You have been granted access to Femme. Set your password here:\n\n"
                    + activationUrl
                    + "\n\nThis link expires in 48 hours.");
    client.beginSend(message).getFinalResult();
    log.info("activation email sent to {}", toEmail);
  }
}
