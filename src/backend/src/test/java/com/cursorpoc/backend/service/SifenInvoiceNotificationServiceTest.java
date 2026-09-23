package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.repository.InvoiceRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.MessageSource;

@ExtendWith(MockitoExtension.class)
class SifenInvoiceNotificationServiceTest {

  private static final long TENANT_ID = 1L;
  private static final long INVOICE_ID = 100L;

  @Mock private InvoiceRepository invoiceRepository;
  @Mock private SifenKudePdfService pdfService;
  @Mock private EmailService emailService;
  @Mock private MessageSource messageSource;

  private SifenInvoiceNotificationService service;
  private Invoice invoice;

  @BeforeEach
  void setUp() {
    service =
        new SifenInvoiceNotificationService(
            invoiceRepository, pdfService, emailService, messageSource, new FemmeTimeProperties());

    invoice = new Invoice();
    invoice.setInvoiceNumber(7);
    invoice.setIssuedAt(Instant.parse("2026-07-28T15:00:00Z"));
    invoice.setTotal(new BigDecimal("45000.00"));
    invoice.setClientDisplayName("Cliente Demo");
    invoice.setRecipientEmail("cliente@example.com");
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.APPROVED);

    lenient()
        .when(invoiceRepository.findByIdAndTenant_Id(INVOICE_ID, TENANT_ID))
        .thenReturn(Optional.of(invoice));
    lenient()
        .when(pdfService.buildKudePdf(TENANT_ID, INVOICE_ID))
        .thenReturn(new SifenKudePdfService.KudePdfResult(new byte[] {1, 2, 3}, "KUDE-x.pdf"));
    lenient()
        .when(pdfService.buildCancelledKudePdf(TENANT_ID, INVOICE_ID))
        .thenReturn(new SifenKudePdfService.KudePdfResult(new byte[] {4, 5, 6}, "KUDE-x.pdf"));
    lenient()
        .when(messageSource.getMessage(anyString(), any(), any()))
        .thenAnswer(inv -> inv.getArgument(0));
  }

  @Test
  void emailKudeAfterApproval_sendsToRecipientAndStampsTimestamp() {
    service.emailKudeAfterApproval(TENANT_ID, INVOICE_ID);

    verify(emailService)
        .sendPdfAttachment(eq("cliente@example.com"), anyString(), anyString(), anyString(), any());
    assertThat(invoice.getSifenKudeEmailedAt()).isNotNull();
  }

  @Test
  void emailKudeAfterApproval_fallsBackToLinkedClientEmail() {
    invoice.setRecipientEmail(null);
    Client client = new Client();
    client.setEmail("perfil@example.com");
    invoice.setClient(client);

    service.emailKudeAfterApproval(TENANT_ID, INVOICE_ID);

    verify(emailService)
        .sendPdfAttachment(eq("perfil@example.com"), anyString(), anyString(), anyString(), any());
  }

  @Test
  void emailKudeAfterApproval_noRecipient_skipsSilently() {
    invoice.setRecipientEmail(null);

    service.emailKudeAfterApproval(TENANT_ID, INVOICE_ID);

    verify(emailService, never())
        .sendPdfAttachment(anyString(), anyString(), anyString(), anyString(), any());
    assertThat(invoice.getSifenKudeEmailedAt()).isNull();
  }

  @Test
  void emailKudeAfterApproval_isIdempotent() {
    invoice.setSifenKudeEmailedAt(LocalDateTime.now());

    service.emailKudeAfterApproval(TENANT_ID, INVOICE_ID);

    verify(emailService, never())
        .sendPdfAttachment(anyString(), anyString(), anyString(), anyString(), any());
  }

  @Test
  void emailKudeAfterApproval_swallowsEmailFailure() {
    doThrow(new RuntimeException("smtp down"))
        .when(emailService)
        .sendPdfAttachment(anyString(), anyString(), anyString(), anyString(), any());

    // Must not propagate — the invoice stays approved regardless.
    service.emailKudeAfterApproval(TENANT_ID, INVOICE_ID);

    assertThat(invoice.getSifenKudeEmailedAt()).isNull();
  }

  @Test
  void emailCancellationNotice_includesEveryDocumentFieldAndAttachesKude() {
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.CANCELLED);
    invoice.setSifenControlNumber("01011371528001001999990122026072811234567800");
    invoice.setSifenCancellationReason("Error en el monto");
    invoice.setSifenCancellationRequestedAt(LocalDateTime.of(2026, 7, 29, 9, 30));
    invoice.setSifenCancellationProtocolNumber("987654321");

    ArgumentCaptor<Object[]> args = ArgumentCaptor.forClass(Object[].class);
    when(messageSource.getMessage(eq("email.sifen.cancellation.body"), args.capture(), any()))
        .thenReturn("body");

    service.emailCancellationNotice(TENANT_ID, INVOICE_ID);

    verify(pdfService).buildCancelledKudePdf(TENANT_ID, INVOICE_ID);
    verify(emailService)
        .sendPdfAttachment(eq("cliente@example.com"), anyString(), eq("body"), anyString(), any());
    assertThat(invoice.getSifenCancellationNotifiedAt()).isNotNull();
    assertThat(args.getValue())
        .contains(
            "0000007",
            "01011371528001001999990122026072811234567800",
            "Error en el monto",
            "987654321");
  }

  @Test
  void emailCancellationNotice_notCancelled_skips() {
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.APPROVED);

    service.emailCancellationNotice(TENANT_ID, INVOICE_ID);

    verify(emailService, never())
        .sendPdfAttachment(anyString(), anyString(), anyString(), anyString(), any());
    assertThat(invoice.getSifenCancellationNotifiedAt()).isNull();
  }
}
