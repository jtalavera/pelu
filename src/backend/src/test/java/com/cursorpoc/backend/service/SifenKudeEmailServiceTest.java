package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.repository.InvoiceRepository;
import java.util.Locale;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.MessageSource;
import org.springframework.web.server.ResponseStatusException;

@ExtendWith(MockitoExtension.class)
class SifenKudeEmailServiceTest {

  private static final long TENANT_ID = 1L;
  private static final long INVOICE_ID = 100L;
  private static final Locale LOCALE = Locale.forLanguageTag("es-PY");

  @Mock private InvoiceRepository invoiceRepository;
  @Mock private SifenKudePdfService pdfService;
  @Mock private EmailService emailService;
  @Mock private MessageSource messageSource;

  private SifenKudeEmailService service;
  private Invoice invoice;

  @BeforeEach
  void setUp() {
    service = new SifenKudeEmailService(invoiceRepository, pdfService, emailService, messageSource);
    invoice = new Invoice();

    org.mockito.Mockito.lenient()
        .when(invoiceRepository.findByIdAndTenant_Id(INVOICE_ID, TENANT_ID))
        .thenReturn(Optional.of(invoice));
    org.mockito.Mockito.lenient()
        .when(pdfService.buildKudePdf(TENANT_ID, INVOICE_ID))
        .thenReturn(new SifenKudePdfService.KudePdfResult(new byte[] {1, 2, 3}, "KUDE-test.pdf"));
    org.mockito.Mockito.lenient()
        .when(messageSource.getMessage(eq("email.kude.subject"), any(), eq(LOCALE)))
        .thenReturn("Subject");
    org.mockito.Mockito.lenient()
        .when(messageSource.getMessage(eq("email.kude.body"), any(), eq(LOCALE)))
        .thenReturn("Body");
  }

  /** AC-17: an explicitly requested email address always wins over the client's own email. */
  @Test
  void sendByEmail_usesTheRequestedEmailWhenProvided() {
    service.sendByEmail(TENANT_ID, INVOICE_ID, "override@example.com", LOCALE);

    verify(emailService)
        .sendPdfAttachment(eq("override@example.com"), any(), any(), eq("KUDE-test.pdf"), any());
  }

  /** AC-17: falls back to the linked client's email when none is explicitly requested. */
  @Test
  void sendByEmail_fallsBackToTheClientsEmailWhenNoneRequested() {
    Client client = new Client();
    client.setEmail("client@example.com");
    invoice.setClient(client);

    service.sendByEmail(TENANT_ID, INVOICE_ID, null, LOCALE);

    verify(emailService)
        .sendPdfAttachment(eq("client@example.com"), any(), any(), eq("KUDE-test.pdf"), any());
  }

  /** No requested email and no client email on file: a clear error, not a silent no-op. */
  @Test
  void sendByEmail_withNoEmailAvailable_throwsAClearError() {
    assertThatThrownBy(() -> service.sendByEmail(TENANT_ID, INVOICE_ID, null, LOCALE))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_KUDE_EMAIL_REQUIRED");

    verify(emailService, never()).sendPdfAttachment(any(), any(), any(), any(), any());
  }

  @Test
  void sendByEmail_blankRequestedEmail_fallsBackToClientEmail() {
    Client client = new Client();
    client.setEmail("client@example.com");
    invoice.setClient(client);

    service.sendByEmail(TENANT_ID, INVOICE_ID, "   ", LOCALE);

    verify(emailService).sendPdfAttachment(eq("client@example.com"), any(), any(), any(), any());
  }

  @Test
  void sendByEmail_attachesTheGeneratedKudePdfBytes() {
    service.sendByEmail(TENANT_ID, INVOICE_ID, "someone@example.com", LOCALE);

    verify(emailService).sendPdfAttachment(any(), any(), any(), any(), eq(new byte[] {1, 2, 3}));
    assertThat(true).isTrue();
  }
}
