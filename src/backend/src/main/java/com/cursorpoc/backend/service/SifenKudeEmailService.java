package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.repository.InvoiceRepository;
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
 * SIFEN HU-08 AC-17: sends an already-generated KuDE PDF to the client by email, directly from the
 * system. Reuses {@link SifenKudePdfService} for the PDF itself (same AC-01/AC-11 guards apply — an
 * invoice that isn't Aprobado/Aprobado con observación can't be emailed either) and {@link
 * EmailService} for the actual send (same enabled/disabled dev branching used by every other
 * outbound email in this app).
 */
@Service
public class SifenKudeEmailService {

  private static final Logger log = LoggerFactory.getLogger(SifenKudeEmailService.class);

  private final InvoiceRepository invoiceRepository;
  private final SifenKudePdfService pdfService;
  private final EmailService emailService;
  private final MessageSource messageSource;

  public SifenKudeEmailService(
      InvoiceRepository invoiceRepository,
      SifenKudePdfService pdfService,
      EmailService emailService,
      MessageSource messageSource) {
    this.invoiceRepository = invoiceRepository;
    this.pdfService = pdfService;
    this.emailService = emailService;
    this.messageSource = messageSource;
  }

  /**
   * @param requestedEmail an explicit recipient (e.g. typed in by the operator) — takes priority
   *     over the client's own email on file. Either may be blank/null, but not both.
   */
  @Transactional(readOnly = true)
  public void sendByEmail(long tenantId, long invoiceId, String requestedEmail, Locale locale) {
    String toEmail = resolveRecipientEmail(tenantId, invoiceId, requestedEmail);

    SifenKudePdfService.KudePdfResult pdf = pdfService.buildKudePdf(tenantId, invoiceId);
    String invoiceLabel = pdf.filename();
    String subject =
        messageSource.getMessage("email.kude.subject", new Object[] {invoiceLabel}, locale);
    String body = messageSource.getMessage("email.kude.body", new Object[] {invoiceLabel}, locale);

    emailService.sendPdfAttachment(toEmail, subject, body, pdf.filename(), pdf.bytes());
    log.info("SIFEN KuDE emailed tenantId={} invoiceId={} to={}", tenantId, invoiceId, toEmail);
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
    if (invoice.getClient() != null) {
      Hibernate.initialize(invoice.getClient());
      String clientEmail = invoice.getClient().getEmail();
      if (clientEmail != null && !clientEmail.isBlank()) {
        return clientEmail;
      }
    }
    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SIFEN_KUDE_EMAIL_REQUIRED");
  }
}
