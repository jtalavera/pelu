package com.cursorpoc.backend.service;

import com.azure.communication.email.EmailClient;
import com.azure.communication.email.EmailClientBuilder;
import com.azure.communication.email.models.EmailAddress;
import com.azure.communication.email.models.EmailAttachment;
import com.azure.communication.email.models.EmailMessage;
import com.azure.core.util.BinaryData;
import java.util.Locale;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.MessageSource;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

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

  /**
   * {@code enabled} alone isn't enough: a blank connection string (the local/dev default when
   * {@code ACS_CONNECTION_STRING} isn't set) previously reached {@link EmailClientBuilder} anyway,
   * which throws an unmapped Azure SDK exception that {@code GlobalExceptionHandler} can't
   * translate to a proper error code — surfacing as HU-33 AC-02's "generic error". Treating a blank
   * connection string the same as disabled keeps that misconfiguration silent (dev-log fallback)
   * instead of a confusing crash.
   */
  private boolean isEffectivelyEnabled() {
    return enabled && !connectionString.isBlank();
  }

  public void sendActivationLink(String toEmail, String activationUrl, Locale locale) {
    String subject = messageSource.getMessage("email.activation.subject", null, locale);
    String body =
        messageSource.getMessage("email.activation.body", new Object[] {activationUrl}, locale);

    if (!isEffectivelyEnabled()) {
      log.info(
          "EMAIL (dev) from={} to={} subject=\"{}\" body=\"{}\"",
          senderAddress.isBlank() ? "no-sender-configured" : senderAddress,
          toEmail,
          subject,
          body);
      return;
    }

    try {
      EmailClient client =
          new EmailClientBuilder().connectionString(connectionString).buildClient();
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
    } catch (Exception ex) {
      log.error("EMAIL send failed to={} subject=\"{}\"", toEmail, subject, ex);
      throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "EMAIL_SEND_FAILED", ex);
    }
  }

  /**
   * SIFEN HU-08 AC-17: sends an email with a single PDF attachment (the KuDE) — same
   * enabled/disabled branching as {@link #sendActivationLink}, logging the would-be send instead of
   * calling Azure Communication Email when {@code app.femme.email.enabled=false} (dev/e2e).
   */
  public void sendPdfAttachment(
      String toEmail,
      String subject,
      String body,
      String attachmentFilename,
      byte[] attachmentBytes) {
    if (!isEffectivelyEnabled()) {
      log.info(
          "EMAIL (dev) from={} to={} subject=\"{}\" attachment={} bytes={}",
          senderAddress.isBlank() ? "no-sender-configured" : senderAddress,
          toEmail,
          subject,
          attachmentFilename,
          attachmentBytes.length);
      return;
    }

    try {
      EmailClient client =
          new EmailClientBuilder().connectionString(connectionString).buildClient();
      EmailAttachment attachment =
          new EmailAttachment(
              attachmentFilename, "application/pdf", BinaryData.fromBytes(attachmentBytes));
      EmailMessage message =
          new EmailMessage()
              .setSenderAddress(senderAddress)
              .setToRecipients(new EmailAddress(toEmail))
              .setSubject(subject)
              .setBodyPlainText(body)
              .setAttachments(attachment);
      client.beginSend(message).getFinalResult();
      log.info(
          "EMAIL SENT (with attachment) from={} to={} subject=\"{}\" attachment={}",
          senderAddress,
          toEmail,
          subject,
          attachmentFilename);
    } catch (Exception ex) {
      log.error(
          "EMAIL send (with attachment) failed to={} subject=\"{}\" attachment={}",
          toEmail,
          subject,
          attachmentFilename,
          ex);
      throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "EMAIL_SEND_FAILED", ex);
    }
  }
}
