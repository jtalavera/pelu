package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.repository.InvoiceRepository;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import org.hibernate.Hibernate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.MessageSource;
import org.springframework.context.annotation.Lazy;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Issue #173: the two automatic client emails around the SIFEN lifecycle —
 *
 * <ul>
 *   <li>the KuDE is emailed once SIFEN returns a successful result for the document (item 2), and
 *   <li>a cancellation notice with the document's data + KuDE is emailed once SIFEN approves a
 *       cancellation event (item 3).
 * </ul>
 *
 * <p>Both are best-effort side effects: they run from the async submission listener / the
 * cancellation flow, and an email failure (or a missing recipient) must never roll back or re-queue
 * the fiscal operation that triggered them. Every path here therefore logs and swallows instead of
 * throwing, and a {@code sifen_kude_emailed_at} / {@code sifen_cancellation_notified_at} timestamp
 * makes each send idempotent against listener retries and the reconciler.
 *
 * <p>Uses the {@code @Autowired @Lazy self} self-proxy so the tiny timestamp writes below go
 * through Spring's {@code @Transactional} proxy (a same-class call would bypass it) — same reason
 * {@link SifenInvoiceCancellationService} does it.
 */
@Service
public class SifenInvoiceNotificationService {

  private static final Logger log = LoggerFactory.getLogger(SifenInvoiceNotificationService.class);

  /** SIFEN comprobantes are Paraguay-only; the client emails are always Spanish (es-PY). */
  private static final Locale NOTIFICATION_LOCALE = Locale.forLanguageTag("es-PY");

  private static final DateTimeFormatter DATE_TIME_FORMAT =
      DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm");

  private final InvoiceRepository invoiceRepository;
  private final SifenKudePdfService pdfService;
  private final EmailService emailService;
  private final MessageSource messageSource;
  private final FemmeTimeProperties timeProperties;

  @Autowired @Lazy private SifenInvoiceNotificationService selfProxy;

  public SifenInvoiceNotificationService(
      InvoiceRepository invoiceRepository,
      SifenKudePdfService pdfService,
      EmailService emailService,
      MessageSource messageSource,
      FemmeTimeProperties timeProperties) {
    this.invoiceRepository = invoiceRepository;
    this.pdfService = pdfService;
    this.emailService = emailService;
    this.messageSource = messageSource;
    this.timeProperties = timeProperties;
  }

  private SifenInvoiceNotificationService self() {
    return selfProxy != null ? selfProxy : this;
  }

  /**
   * Item 2: emails the KuDE to the document's recipient after SIFEN returns Aprobado / Aprobado con
   * observación. No-op (logged) when the KuDE was already emailed, or when no recipient address is
   * on file. Never throws — the caller is the async submission listener.
   */
  public void emailKudeAfterApproval(long tenantId, long invoiceId) {
    try {
      Recipient recipient = self().resolveKudeRecipient(tenantId, invoiceId);
      if (recipient == null) {
        return;
      }
      SifenKudePdfService.KudePdfResult pdf = pdfService.buildKudePdf(tenantId, invoiceId);
      String subject =
          messageSource.getMessage(
              "email.kude.subject", new Object[] {pdf.filename()}, NOTIFICATION_LOCALE);
      String body =
          messageSource.getMessage(
              "email.kude.body", new Object[] {pdf.filename()}, NOTIFICATION_LOCALE);
      emailService.sendPdfAttachment(recipient.email(), subject, body, pdf.filename(), pdf.bytes());
      self().markKudeEmailed(tenantId, invoiceId, now());
      log.info(
          "SIFEN KuDE auto-emailed after approval tenantId={} invoiceId={} to={}",
          tenantId,
          invoiceId,
          recipient.email());
    } catch (Exception ex) {
      log.error(
          "SIFEN KuDE auto-email failed tenantId={} invoiceId={} — invoice stays approved",
          tenantId,
          invoiceId,
          ex);
    }
  }

  /**
   * Item 3: emails the client a cancellation notice (all the cancelled document's data + its KuDE
   * attached) after SIFEN approves the cancellation event. No-op (logged) when the invoice isn't
   * actually cancelled, the notice was already sent, or no recipient address is on file. Never
   * throws — the caller is the cancellation flow, which has already committed the cancellation.
   */
  public void emailCancellationNotice(long tenantId, long invoiceId) {
    try {
      CancellationNotice notice = self().resolveCancellationNotice(tenantId, invoiceId);
      if (notice == null) {
        return;
      }
      SifenKudePdfService.KudePdfResult pdf = pdfService.buildCancelledKudePdf(tenantId, invoiceId);
      String subject =
          messageSource.getMessage(
              "email.sifen.cancellation.subject",
              new Object[] {notice.invoiceNumber()},
              NOTIFICATION_LOCALE);
      String body =
          messageSource.getMessage(
              "email.sifen.cancellation.body",
              new Object[] {
                notice.invoiceNumber(),
                orDash(notice.cdc()),
                notice.issuedAt(),
                notice.total(),
                orDash(notice.clientName()),
                orDash(notice.reason()),
                orDash(notice.cancelledAt()),
                orDash(notice.protocolNumber())
              },
              NOTIFICATION_LOCALE);
      emailService.sendPdfAttachment(
          notice.recipientEmail(), subject, body, pdf.filename(), pdf.bytes());
      self().markCancellationNotified(tenantId, invoiceId, now());
      log.info(
          "SIFEN cancellation notice emailed tenantId={} invoiceId={} to={}",
          tenantId,
          invoiceId,
          notice.recipientEmail());
    } catch (Exception ex) {
      log.error(
          "SIFEN cancellation notice email failed tenantId={} invoiceId={} — cancellation stands",
          tenantId,
          invoiceId,
          ex);
    }
  }

  @Transactional(readOnly = true)
  public Recipient resolveKudeRecipient(long tenantId, long invoiceId) {
    Invoice invoice = requireInvoice(tenantId, invoiceId);
    if (invoice.getSifenKudeEmailedAt() != null) {
      log.info(
          "SIFEN KuDE already auto-emailed, skipping tenantId={} invoiceId={}",
          tenantId,
          invoiceId);
      return null;
    }
    String email = recipientEmail(invoice);
    if (email == null) {
      log.warn(
          "SIFEN KuDE auto-email skipped, no recipient on file tenantId={} invoiceId={}",
          tenantId,
          invoiceId);
      return null;
    }
    return new Recipient(email);
  }

  @Transactional(readOnly = true)
  public CancellationNotice resolveCancellationNotice(long tenantId, long invoiceId) {
    Invoice invoice = requireInvoice(tenantId, invoiceId);
    if (invoice.getSifenSubmissionStatus() != SifenSubmissionStatus.CANCELLED) {
      log.info(
          "SIFEN cancellation notice skipped, invoice not cancelled tenantId={} invoiceId={}",
          tenantId,
          invoiceId);
      return null;
    }
    if (invoice.getSifenCancellationNotifiedAt() != null) {
      log.info(
          "SIFEN cancellation notice already sent, skipping tenantId={} invoiceId={}",
          tenantId,
          invoiceId);
      return null;
    }
    String email = recipientEmail(invoice);
    if (email == null) {
      log.warn(
          "SIFEN cancellation notice skipped, no recipient on file tenantId={} invoiceId={}",
          tenantId,
          invoiceId);
      return null;
    }
    String clientName = invoice.getClientDisplayName();
    if (clientName == null && invoice.getClient() != null) {
      Hibernate.initialize(invoice.getClient());
      clientName = invoice.getClient().getFullName();
    }
    return new CancellationNotice(
        email,
        formatInvoiceNumber(invoice.getInvoiceNumber()),
        invoice.getSifenControlNumber(),
        invoice.getIssuedAt() == null
            ? "-"
            : DATE_TIME_FORMAT.format(invoice.getIssuedAt().atZone(timeProperties.zoneId())),
        "Gs. " + formatMoney(invoice.getTotal()),
        clientName,
        invoice.getSifenCancellationReason(),
        invoice.getSifenCancellationRequestedAt() == null
            ? null
            : DATE_TIME_FORMAT.format(invoice.getSifenCancellationRequestedAt()),
        invoice.getSifenCancellationProtocolNumber());
  }

  @Transactional
  public void markKudeEmailed(long tenantId, long invoiceId, LocalDateTime at) {
    Invoice invoice = requireInvoice(tenantId, invoiceId);
    invoice.setSifenKudeEmailedAt(at);
    invoiceRepository.save(invoice);
  }

  @Transactional
  public void markCancellationNotified(long tenantId, long invoiceId, LocalDateTime at) {
    Invoice invoice = requireInvoice(tenantId, invoiceId);
    invoice.setSifenCancellationNotifiedAt(at);
    invoiceRepository.save(invoice);
  }

  private Invoice requireInvoice(long tenantId, long invoiceId) {
    return invoiceRepository
        .findByIdAndTenant_Id(invoiceId, tenantId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "INVOICE_NOT_FOUND"));
  }

  /**
   * The form-captured recipient email wins; the linked client's own email on file is the fallback.
   */
  private static String recipientEmail(Invoice invoice) {
    if (invoice.getRecipientEmail() != null && !invoice.getRecipientEmail().isBlank()) {
      return invoice.getRecipientEmail().trim();
    }
    Client client = invoice.getClient();
    if (client != null) {
      Hibernate.initialize(client);
      if (client.getEmail() != null && !client.getEmail().isBlank()) {
        return client.getEmail().trim();
      }
    }
    return null;
  }

  private LocalDateTime now() {
    return LocalDateTime.now(timeProperties.zoneId());
  }

  private static String orDash(String value) {
    return value == null || value.isBlank() ? "-" : value;
  }

  private static String formatInvoiceNumber(int number) {
    return String.format("%07d", number);
  }

  private static String formatMoney(BigDecimal value) {
    if (value == null) {
      return "0";
    }
    DecimalFormatSymbols symbols = DecimalFormatSymbols.getInstance(NOTIFICATION_LOCALE);
    symbols.setGroupingSeparator('.');
    DecimalFormat format = new DecimalFormat("#,##0", symbols);
    return format.format(value.setScale(0, RoundingMode.HALF_UP));
  }

  record Recipient(String email) {}

  record CancellationNotice(
      String recipientEmail,
      String invoiceNumber,
      String cdc,
      String issuedAt,
      String total,
      String clientName,
      String reason,
      String cancelledAt,
      String protocolNumber) {}
}
