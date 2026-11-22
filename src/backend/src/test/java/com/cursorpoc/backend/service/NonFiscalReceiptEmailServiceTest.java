package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.repository.InvoiceRepository;
import java.util.Locale;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.MessageSource;
import org.springframework.web.server.ResponseStatusException;

class NonFiscalReceiptEmailServiceTest {

  private static final Locale ES = Locale.forLanguageTag("es-PY");

  private final InvoiceRepository invoices = mock(InvoiceRepository.class);
  private final NonFiscalReceiptPdfService pdf = mock(NonFiscalReceiptPdfService.class);
  private final EmailService email = mock(EmailService.class);
  private final MessageSource messages = mock(MessageSource.class);
  private final NonFiscalReceiptEmailService service =
      new NonFiscalReceiptEmailService(invoices, pdf, email, messages);

  @BeforeEach
  void setUp() {
    when(pdf.buildReceipt(eq(5L), eq(1L), any()))
        .thenReturn(
            new NonFiscalReceiptPdfService.ReceiptResult(new byte[] {1, 2}, "COMPROBANTE-5.pdf"));
    when(messages.getMessage(eq("email.receipt.subject"), any(), eq(ES)))
        .thenReturn("Tu comprobante");
    when(messages.getMessage(eq("email.receipt.body"), any(), eq(ES))).thenReturn("Adjunto");
  }

  private static Invoice invoice(String recipientEmail, String clientEmail) {
    Invoice invoice = new Invoice();
    invoice.setRecipientEmail(recipientEmail);
    if (clientEmail != null) {
      Client client = new Client();
      client.setEmail(clientEmail);
      invoice.setClient(client);
    }
    return invoice;
  }

  @Test
  void anExplicitAddress_winsAndTheReceiptIsAttached() {
    service.sendByEmail(1L, 5L, " ana@mail.com ", "TICKET", ES);

    verify(email)
        .sendPdfAttachment(
            "ana@mail.com", "Tu comprobante", "Adjunto", "COMPROBANTE-5.pdf", new byte[] {1, 2});
    verify(pdf).buildReceipt(5L, 1L, NonFiscalReceiptPdfService.Format.TICKET);
  }

  @Test
  void withoutAnAddress_itUsesTheOneOnTheInvoice_thenTheClients() {
    Invoice withRecipient = invoice("on@invoice.com", "client@mail.com");
    when(invoices.findByIdAndTenant_Id(5L, 1L)).thenReturn(Optional.of(withRecipient));
    service.sendByEmail(1L, 5L, null, null, ES);
    verify(email)
        .sendPdfAttachment(eq("on@invoice.com"), anyString(), anyString(), anyString(), any());

    when(invoices.findByIdAndTenant_Id(5L, 1L))
        .thenReturn(Optional.of(invoice(" ", "client@mail.com")));
    service.sendByEmail(1L, 5L, "", null, ES);
    verify(email)
        .sendPdfAttachment(eq("client@mail.com"), anyString(), anyString(), anyString(), any());
  }

  @Test
  void noAddressAnywhere_isRefusedBeforeBuildingAnything() {
    Invoice withNothing = invoice(null, null);
    when(invoices.findByIdAndTenant_Id(5L, 1L)).thenReturn(Optional.of(withNothing));

    assertThatThrownBy(() -> service.sendByEmail(1L, 5L, null, null, ES))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("RECEIPT_EMAIL_REQUIRED");
    verify(email, never()).sendPdfAttachment(any(), any(), any(), any(), any());
  }

  @Test
  void aMalformedAddress_isRefused() {
    assertThatThrownBy(() -> service.sendByEmail(1L, 5L, "no-es-un-email", null, ES))
        .hasMessageContaining("RECEIPT_EMAIL_INVALID");
    verify(email, never()).sendPdfAttachment(any(), any(), any(), any(), any());
  }

  @Test
  void anInvoiceOfAnotherTenant_isNotFound() {
    when(invoices.findByIdAndTenant_Id(5L, 1L)).thenReturn(Optional.empty());

    assertThat(
            org.junit.jupiter.api.Assertions.assertThrows(
                ResponseStatusException.class, () -> service.sendByEmail(1L, 5L, null, null, ES)))
        .hasMessageContaining("INVOICE_NOT_FOUND");
  }

  @Test
  void theGuardsOfThePdfApply_forExampleNotAvailableWithSifen() {
    when(pdf.buildReceipt(eq(5L), eq(1L), any()))
        .thenThrow(
            new ResponseStatusException(
                org.springframework.http.HttpStatus.CONFLICT, "SIFEN_LEGACY_PDF_DISABLED"));

    assertThatThrownBy(() -> service.sendByEmail(1L, 5L, "a@b.com", null, ES))
        .hasMessageContaining("SIFEN_LEGACY_PDF_DISABLED");
    verify(email, never()).sendPdfAttachment(any(), any(), any(), any(), any());
  }
}
