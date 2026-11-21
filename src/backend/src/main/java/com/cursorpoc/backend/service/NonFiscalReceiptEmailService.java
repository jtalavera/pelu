package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.util.EmailFormatValidator;
import java.util.Locale;
import org.hibernate.Hibernate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.MessageSource;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Sends the NON-FISCAL receipt PDF to the client by e-mail — the counterpart of {@link
 * SifenKudeEmailService} for salons without SIFEN, so «Compartir con el cliente» works for every
 * issued invoice. The PDF comes from {@link NonFiscalReceiptPdfService}, so its guards apply
 * unchanged (flag {@code NON_FISCAL_RECEIPT}, not available with SIFEN, only for issued invoices).
 */
@Service
public class NonFiscalReceiptEmailService {

  private static final Logger log = LoggerFactory.getLogger(NonFiscalReceiptEmailService.class);

  private final InvoiceRepository invoiceRepository;
  private final NonFiscalReceiptPdfService pdfService;
  private final EmailService emailService;
  private final MessageSource messageSource;

  public NonFiscalReceiptEmailService(
      InvoiceRepository invoiceRepository,
      NonFiscalReceiptPdfService pdfService,
      EmailService emailService,
      MessageSource messageSource) {
    this.invoiceRepository = invoiceRepository;
    this.pdfService = pdfService;
    this.emailService = emailService;
    this.messageSource = messageSource;
  }

  /**
   * @param requestedEmail recipient typed by the operator; wins over the one on the invoice and the
   *     client's profile. At least one of the three must exist (400 {@code RECEIPT_EMAIL_REQUIRED})
   *     and be well formed (400 {@code RECEIPT_EMAIL_INVALID}).
   * @param format {@code A4} (default) or {@code TICKET}
   */
  @Transactional(readOnly = true)
  public void sendByEmail(
      long tenantId, long invoiceId, String requestedEmail, String format, Locale locale) {
    String toEmail = resolveRecipientEmail(tenantId, invoiceId, requestedEmail);
    if (!EmailFormatValidator.isValid(toEmail)) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "RECEIPT_EMAIL_INVALID");
    }
    NonFiscalReceiptPdfService.ReceiptResult pdf =
        pdfService.buildReceipt(
            invoiceId, tenantId, NonFiscalReceiptPdfService.Format.parse(format));
    String subject =
        messageSource.getMessage("email.receipt.subject", new Object[] {pdf.filename()}, locale);
    String body =
        messageSource.getMessage("email.receipt.body", new Object[] {pdf.filename()}, locale);
    emailService.sendPdfAttachment(toEmail, subject, body, pdf.filename(), pdf.bytes());
    log.info("non-fiscal receipt emailed tenantId={} invoiceId={}", tenantId, invoiceId);
  }

  private String resolveRecipientEmail(long tenantId, long invoiceId, String requestedEmail) {
    if (requestedEmail != null && !requestedEmail.isBlank()) {
      return requestedEmail.trim();
    }
    Invoice invoice =
        invoiceRepository
            .findByIdAndTenant_Id(invoiceId, tenantId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "INVOICE_NOT_FOUND"));
    if (invoice.getRecipientEmail() != null && !invoice.getRecipientEmail().isBlank()) {
      return invoice.getRecipientEmail().trim();
    }
    if (invoice.getClient() != null) {
      Hibernate.initialize(invoice.getClient());
      String clientEmail = invoice.getClient().getEmail();
      if (clientEmail != null && !clientEmail.isBlank()) {
        return clientEmail.trim();
      }
    }
    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "RECEIPT_EMAIL_REQUIRED");
  }
}
