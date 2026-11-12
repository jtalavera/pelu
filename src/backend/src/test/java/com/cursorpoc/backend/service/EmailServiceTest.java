package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.azure.communication.email.EmailClient;
import com.azure.communication.email.models.EmailMessage;
import com.azure.communication.email.models.EmailSendResult;
import com.azure.core.util.polling.LongRunningOperationStatus;
import com.azure.core.util.polling.PollResponse;
import com.azure.core.util.polling.SyncPoller;
import java.time.Duration;
import java.util.Locale;
import java.util.concurrent.TimeoutException;
import java.util.function.Function;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.MessageSource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;

/**
 * HU-33 AC-02: "Enviar por Correo Electronico" used to surface an opaque, untranslatable error
 * whenever the real Azure Communication Email call failed — most commonly in local/dev, where
 * {@code app.femme.email.enabled} defaults to true but {@code ACS_CONNECTION_STRING} is blank (see
 * application.properties). {@code app.femme.email.enabled=false} in application-e2e.properties
 * means Playwright never exercises the real-send branch this test covers, so it's JUnit-only.
 */
class EmailServiceTest {

  private EmailService newService(boolean enabled, String connectionString) {
    MessageSource messageSource = mock(MessageSource.class);
    when(messageSource.getMessage(anyString(), any(), any(Locale.class))).thenReturn("body");
    EmailService service = new EmailService(messageSource);
    ReflectionTestUtils.setField(service, "enabled", enabled);
    ReflectionTestUtils.setField(service, "connectionString", connectionString);
    ReflectionTestUtils.setField(service, "senderAddressReminders", "turnos@example.com");
    ReflectionTestUtils.setField(service, "senderAddressInvoices", "factura@example.com");
    ReflectionTestUtils.setField(service, "senderAddressGeneric", "no-reply@example.com");
    return service;
  }

  @Test
  void sendPdfAttachment_disabled_logsInsteadOfSending() {
    EmailService service = newService(false, "");

    assertThatCode(
            () ->
                service.sendPdfAttachment(
                    "cliente@example.com", "Subj", "Body", "f.pdf", new byte[] {1}))
        .doesNotThrowAnyException();
  }

  /**
   * The bug behind AC-02: {@code enabled=true} with a blank connection string (the local/dev
   * default) used to reach the Azure SDK client builder and throw an unmapped exception. Blank
   * connection string is now treated the same as disabled — same safe dev-log fallback, no crash.
   */
  @Test
  void sendPdfAttachment_enabledWithBlankConnectionString_fallsBackToDevLog() {
    EmailService service = newService(true, "");

    assertThatCode(
            () ->
                service.sendPdfAttachment(
                    "cliente@example.com", "Subj", "Body", "f.pdf", new byte[] {1}))
        .doesNotThrowAnyException();
  }

  /** Issue #218: appointment reminders use this generic send — same dev/e2e fallback. */
  @Test
  void sendPlainTextEmail_disabled_logsInsteadOfSending() {
    EmailService service = newService(false, "");

    assertThatCode(() -> service.sendPlainTextEmail("cliente@example.com", "Subj", "Body"))
        .doesNotThrowAnyException();
  }

  @Test
  void sendPlainTextEmail_realSendFailure_wrapsAsEmailSendFailed() {
    EmailService service = newService(true, "not-a-valid-connection-string");

    assertThatThrownBy(() -> service.sendPlainTextEmail("cliente@example.com", "Subj", "Body"))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("EMAIL_SEND_FAILED");
  }

  /**
   * A real (but invalid/unreachable) configuration must fail with a translatable
   * SCREAMING_SNAKE_CASE code, not a raw Azure SDK exception falling through to Spring's generic
   * 500 handler.
   */
  @Test
  void sendPdfAttachment_realSendFailure_wrapsAsEmailSendFailed() {
    EmailService service = newService(true, "not-a-valid-connection-string");

    assertThatThrownBy(
            () ->
                service.sendPdfAttachment(
                    "cliente@example.com", "Subj", "Body", "f.pdf", new byte[] {1}))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("EMAIL_SEND_FAILED");
  }

  @Test
  void sendActivationLink_realSendFailure_wrapsAsEmailSendFailed() {
    EmailService service = newService(true, "not-a-valid-connection-string");

    assertThatThrownBy(
            () ->
                service.sendActivationLink(
                    "cliente@example.com",
                    "https://x/activate",
                    "Acme Salon",
                    Locale.forLanguageTag("es-PY")))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("EMAIL_SEND_FAILED");
  }

  /**
   * Regression coverage for the invitation email always saying "Femme" regardless of which tenant
   * the admin was invited into — {@code tenantName} must reach the {@code MessageSource} as the
   * body's {@code {1}} argument.
   */
  @Test
  void sendActivationLink_disabled_includesTenantNameInLoggedBody() {
    MessageSource messageSource = mock(MessageSource.class);
    when(messageSource.getMessage(eq("email.activation.subject"), any(), any(Locale.class)))
        .thenReturn("Activate your Femme account");
    when(messageSource.getMessage(eq("email.activation.body"), any(), any(Locale.class)))
        .thenAnswer(
            invocation -> {
              Object[] args = invocation.getArgument(1);
              return "You have been granted access to " + args[1] + " on Femme: " + args[0];
            });
    EmailService service = new EmailService(messageSource);
    ReflectionTestUtils.setField(service, "enabled", false);
    ReflectionTestUtils.setField(service, "connectionString", "");
    ReflectionTestUtils.setField(service, "senderAddressGeneric", "no-reply@example.com");

    assertThatCode(
            () ->
                service.sendActivationLink(
                    "admin@acme.example",
                    "https://x/activate",
                    "Acme Salon",
                    Locale.forLanguageTag("es-PY")))
        .doesNotThrowAnyException();

    ArgumentCaptor<Object[]> argsCaptor = ArgumentCaptor.forClass(Object[].class);
    verify(messageSource)
        .getMessage(eq("email.activation.body"), argsCaptor.capture(), any(Locale.class));
    assertThat(argsCaptor.getValue()).containsExactly("https://x/activate", "Acme Salon");
  }

  @SuppressWarnings("unchecked")
  private static SyncPoller<EmailSendResult, EmailSendResult> stubAcs(EmailService service) {
    EmailClient client = mock(EmailClient.class);
    SyncPoller<EmailSendResult, EmailSendResult> poller = mock(SyncPoller.class);
    when(client.beginSend(any(EmailMessage.class))).thenReturn(poller);
    Function<String, EmailClient> factory = cs -> client;
    ReflectionTestUtils.setField(service, "clientFactory", factory);
    ReflectionTestUtils.setField(service, "sendStatusTimeout", Duration.ofSeconds(1));
    return poller;
  }

  /**
   * 2026-11-12 prod incident: ACS accepted the KuDE email but never reported a final status, and
   * the unbounded {@code getFinalResult()} hung the SIFEN queue consumer forever. The wait is now
   * bounded — a send whose status isn't final in time returns (ACS already has the message).
   */
  @Test
  void sendPdfAttachment_acsStatusNeverFinal_returnsAfterTheBoundInsteadOfHanging() {
    EmailService service = newService(true, "endpoint=https://x/;accesskey=a2V5");
    SyncPoller<EmailSendResult, EmailSendResult> poller = stubAcs(service);
    when(poller.waitForCompletion(Duration.ofSeconds(1)))
        .thenThrow(new RuntimeException(new TimeoutException("still running")));

    assertThatCode(
            () ->
                service.sendPdfAttachment(
                    "cliente@example.com", "Subj", "Body", "f.pdf", new byte[] {1}))
        .doesNotThrowAnyException();
    verify(poller).waitForCompletion(Duration.ofSeconds(1));
  }

  @Test
  void sendPlainTextEmail_acsStatusStillRunningAtTheBound_returns() {
    EmailService service = newService(true, "endpoint=https://x/;accesskey=a2V5");
    SyncPoller<EmailSendResult, EmailSendResult> poller = stubAcs(service);
    when(poller.waitForCompletion(Duration.ofSeconds(1)))
        .thenReturn(new PollResponse<>(LongRunningOperationStatus.IN_PROGRESS, null));

    assertThatCode(() -> service.sendPlainTextEmail("cliente@example.com", "Subj", "Body"))
        .doesNotThrowAnyException();
  }

  @Test
  void sendPdfAttachment_acsReportsFailed_wrapsAsEmailSendFailed() {
    EmailService service = newService(true, "endpoint=https://x/;accesskey=a2V5");
    SyncPoller<EmailSendResult, EmailSendResult> poller = stubAcs(service);
    when(poller.waitForCompletion(Duration.ofSeconds(1)))
        .thenReturn(new PollResponse<>(LongRunningOperationStatus.FAILED, null));

    assertThatThrownBy(
            () ->
                service.sendPdfAttachment(
                    "cliente@example.com", "Subj", "Body", "f.pdf", new byte[] {1}))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("EMAIL_SEND_FAILED");
  }

  @Test
  void sendActivationLink_acsCompletes_doesNotThrow() {
    EmailService service = newService(true, "endpoint=https://x/;accesskey=a2V5");
    SyncPoller<EmailSendResult, EmailSendResult> poller = stubAcs(service);
    when(poller.waitForCompletion(Duration.ofSeconds(1)))
        .thenReturn(new PollResponse<>(LongRunningOperationStatus.SUCCESSFULLY_COMPLETED, null));

    assertThatCode(
            () ->
                service.sendActivationLink(
                    "admin@acme.example", "https://x/a", "Acme", Locale.forLanguageTag("es-PY")))
        .doesNotThrowAnyException();
  }
}
