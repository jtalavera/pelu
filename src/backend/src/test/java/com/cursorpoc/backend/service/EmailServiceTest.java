package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.Locale;
import org.junit.jupiter.api.Test;
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
    ReflectionTestUtils.setField(service, "senderAddress", "no-reply@example.com");
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
                    "cliente@example.com", "https://x/activate", Locale.forLanguageTag("es-PY")))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("EMAIL_SEND_FAILED");
  }
}
