package com.cursorpoc.backend.service;

import com.azure.communication.email.EmailClient;
import com.azure.communication.email.EmailClientBuilder;
import com.azure.communication.email.models.EmailAddress;
import com.azure.communication.email.models.EmailAttachment;
import com.azure.communication.email.models.EmailMessage;
import com.azure.communication.email.models.EmailSendResult;
import com.azure.core.util.BinaryData;
import com.azure.core.util.polling.LongRunningOperationStatus;
import com.azure.core.util.polling.PollResponse;
import com.azure.core.util.polling.SyncPoller;
import java.time.Duration;
import java.util.Locale;
import java.util.concurrent.TimeoutException;
import java.util.function.Function;
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

  @Value("${app.femme.email.sender-address.reminders:}")
  private String senderAddressReminders;

  @Value("${app.femme.email.sender-address.invoices:}")
  private String senderAddressInvoices;

  @Value("${app.femme.email.sender-address.generic:}")
  private String senderAddressGeneric;

  /**
   * Upper bound on how long a send waits for ACS to report the message's final status. ACS accepts
   * the send (HTTP 202) right away and then reports progress through a status operation that the
   * SDK polls; with no bound, {@code beginSend(...).getFinalResult()} polled that status forever
   * when ACS never reached a terminal state (2026-11-12 prod incident: ACS kept answering "running"
   * / 429 and the single SIFEN Service Bus consumer thread hung inside the KuDE auto-email, so no
   * further invoice was ever transmitted). Past this bound the send is treated as accepted — ACS
   * already has the message — and logged as unconfirmed.
   */
  @Value("${app.femme.email.send-status-timeout:PT30S}")
  private Duration sendStatusTimeout = Duration.ofSeconds(30);

  /** Seam for tests; production builds a fresh client per send from the connection string. */
  private Function<String, EmailClient> clientFactory =
      cs -> new EmailClientBuilder().connectionString(cs).buildClient();

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

  public void sendActivationLink(
      String toEmail, String activationUrl, String tenantName, Locale locale) {
    String subject =
        messageSource.getMessage("email.activation.subject", new Object[] {tenantName}, locale);
    String body =
        messageSource.getMessage(
            "email.activation.body", new Object[] {activationUrl, tenantName}, locale);

    if (!isEffectivelyEnabled()) {
      log.info(
          "EMAIL (dev) from={} to={} subject=\"{}\" body=\"{}\"",
          senderAddressGeneric.isBlank() ? "no-sender-configured" : senderAddressGeneric,
          toEmail,
          subject,
          body);
      return;
    }

    try {
      EmailMessage message =
          new EmailMessage()
              .setSenderAddress(senderAddressGeneric)
              .setToRecipients(new EmailAddress(toEmail))
              .setSubject(subject)
              .setBodyPlainText(body);
      submit(message);
      log.info(
          "EMAIL SENT from={} to={} subject=\"{}\" locale={}",
          senderAddressGeneric,
          toEmail,
          subject,
          locale.getLanguage());
    } catch (Exception ex) {
      log.error("EMAIL send failed to={} subject=\"{}\"", toEmail, subject, ex);
      throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "EMAIL_SEND_FAILED", ex);
    }
  }

  /**
   * HU-44 AC-2/AC-4: sends the password-reset link — same shape and dev/e2e logging fallback as
   * {@link #sendActivationLink} — used both by the self-service "forgot password" flow and by a
   * Platform-Admin-triggered reset for a tenant user who already activated their account.
   */
  public void sendPasswordResetLink(
      String toEmail, String resetUrl, String tenantName, Locale locale) {
    String subject =
        messageSource.getMessage("email.passwordReset.subject", new Object[] {tenantName}, locale);
    String body =
        messageSource.getMessage(
            "email.passwordReset.body", new Object[] {resetUrl, tenantName}, locale);

    if (!isEffectivelyEnabled()) {
      log.info(
          "EMAIL (dev) from={} to={} subject=\"{}\" body=\"{}\"",
          senderAddressGeneric.isBlank() ? "no-sender-configured" : senderAddressGeneric,
          toEmail,
          subject,
          body);
      return;
    }

    try {
      EmailMessage message =
          new EmailMessage()
              .setSenderAddress(senderAddressGeneric)
              .setToRecipients(new EmailAddress(toEmail))
              .setSubject(subject)
              .setBodyPlainText(body);
      submit(message);
      log.info(
          "EMAIL SENT from={} to={} subject=\"{}\" locale={}",
          senderAddressGeneric,
          toEmail,
          subject,
          locale.getLanguage());
    } catch (Exception ex) {
      log.error("EMAIL send failed to={} subject=\"{}\"", toEmail, subject, ex);
      throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "EMAIL_SEND_FAILED", ex);
    }
  }

  /**
   * Issue #218: generic plain-text send for system-triggered notifications that build their own
   * subject/body via {@link MessageSource} (e.g. appointment reminders) instead of hard-coding a
   * dedicated method per notification type — same enabled/disabled dev-log branching as every other
   * send here.
   */
  public void sendPlainTextEmail(String toEmail, String subject, String body) {
    if (!isEffectivelyEnabled()) {
      log.info(
          "EMAIL (dev) from={} to={} subject=\"{}\" body=\"{}\"",
          senderAddressReminders.isBlank() ? "no-sender-configured" : senderAddressReminders,
          toEmail,
          subject,
          body);
      return;
    }

    try {
      EmailMessage message =
          new EmailMessage()
              .setSenderAddress(senderAddressReminders)
              .setToRecipients(new EmailAddress(toEmail))
              .setSubject(subject)
              .setBodyPlainText(body);
      submit(message);
      log.info("EMAIL SENT from={} to={} subject=\"{}\"", senderAddressReminders, toEmail, subject);
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
          senderAddressInvoices.isBlank() ? "no-sender-configured" : senderAddressInvoices,
          toEmail,
          subject,
          attachmentFilename,
          attachmentBytes.length);
      return;
    }

    try {
      EmailAttachment attachment =
          new EmailAttachment(
              attachmentFilename, "application/pdf", BinaryData.fromBytes(attachmentBytes));
      EmailMessage message =
          new EmailMessage()
              .setSenderAddress(senderAddressInvoices)
              .setToRecipients(new EmailAddress(toEmail))
              .setSubject(subject)
              .setBodyPlainText(body)
              .setAttachments(attachment);
      submit(message);
      log.info(
          "EMAIL SENT (with attachment) from={} to={} subject=\"{}\" attachment={}",
          senderAddressInvoices,
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

  /**
   * Hands the message to ACS and waits at most {@link #sendStatusTimeout} for its final status.
   * Throws when ACS reports the send as failed (callers map it to {@code EMAIL_SEND_FAILED}); when
   * the status is still not final after the bound, logs a warning and returns — the message was
   * accepted, and blocking the caller (an HTTP request or the SIFEN queue consumer) is worse.
   */
  private void submit(EmailMessage message) {
    SyncPoller<EmailSendResult, EmailSendResult> poller =
        clientFactory.apply(connectionString).beginSend(message);
    PollResponse<EmailSendResult> response;
    try {
      response = poller.waitForCompletion(sendStatusTimeout);
    } catch (RuntimeException ex) {
      if (!(ex.getCause() instanceof TimeoutException)) {
        throw ex;
      }
      response = null;
    }
    if (response == null || !response.getStatus().isComplete()) {
      log.warn(
          "EMAIL accepted by ACS but final status not confirmed within {}s subject=\"{}\"",
          sendStatusTimeout.toSeconds(),
          message.getSubject());
      return;
    }
    if (response.getStatus() != LongRunningOperationStatus.SUCCESSFULLY_COMPLETED) {
      throw new IllegalStateException(
          "ACS email send finished with status " + response.getStatus());
    }
  }
}
