package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.FiscalStamp;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.SifenNumberVoidingEvent;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.domain.enums.SifenNumberVoidingStatus;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.repository.SifenNumberVoidingEventRepository;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import javax.xml.parsers.DocumentBuilderFactory;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import org.w3c.dom.Document;

/** RT-25 (Hardening_SIFEN.md). */
@ExtendWith(MockitoExtension.class)
class SifenNumberVoidingServiceTest {

  private static final long TENANT_ID = 1L;
  private static final long INVOICE_ID = 100L;

  @Mock private SifenNumberVoidingEventRepository repository;
  @Mock private InvoiceRepository invoiceRepository;
  @Mock private SifenNumberVoidingEventXmlService eventXmlService;
  @Mock private SifenDocumentSigningService signingService;
  @Mock private SifenEventClient eventClient;
  @Spy private FemmeTimeProperties timeProperties = new FemmeTimeProperties();

  private SifenNumberVoidingService service;

  @BeforeEach
  void setUp() {
    service =
        new SifenNumberVoidingService(
            repository,
            invoiceRepository,
            eventXmlService,
            signingService,
            eventClient,
            timeProperties);
  }

  private FiscalStamp stamp() {
    FiscalStamp stamp = new FiscalStamp();
    stamp.setStampNumber("12345678");
    stamp.setEstablishment(1);
    stamp.setExpeditionPoint(1);
    return stamp;
  }

  private Invoice invoice() {
    Invoice invoice = new Invoice();
    invoice.setInvoiceNumber(42);
    invoice.setFiscalStamp(stamp());
    return invoice;
  }

  @Test
  void computeDeadline_isDay15OfTheFollowingMonth() {
    assertThat(SifenNumberVoidingService.computeDeadline(LocalDate.of(2026, 8, 13)))
        .isEqualTo(LocalDate.of(2026, 9, 15));
    assertThat(SifenNumberVoidingService.computeDeadline(LocalDate.of(2026, 12, 20)))
        .isEqualTo(LocalDate.of(2027, 1, 15));
  }

  @Test
  void recordPendingForRejectedInvoice_createsARowWithTheInvoiceNumberAsTheRange() {
    when(repository.findByInvoiceId(INVOICE_ID)).thenReturn(Optional.empty());
    when(invoiceRepository.findByIdAndTenant_Id(INVOICE_ID, TENANT_ID))
        .thenReturn(Optional.of(invoice()));

    service.recordPendingForRejectedInvoice(TENANT_ID, INVOICE_ID);

    ArgumentCaptor<SifenNumberVoidingEvent> captor =
        ArgumentCaptor.forClass(SifenNumberVoidingEvent.class);
    verify(repository).save(captor.capture());
    SifenNumberVoidingEvent saved = captor.getValue();
    assertThat(saved.getTenantId()).isEqualTo(TENANT_ID);
    assertThat(saved.getInvoiceId()).isEqualTo(INVOICE_ID);
    assertThat(saved.getRangeFrom()).isEqualTo(42);
    assertThat(saved.getRangeTo()).isEqualTo(42);
    assertThat(saved.getStatus()).isEqualTo(SifenNumberVoidingStatus.PENDING);
    assertThat(saved.getDeadlineDate()).isNotNull();
    assertThat(saved.getReason()).isNotBlank();
  }

  // ── Issue #175: correct & resend guards ───────────────────────────────────────────────────

  @Test
  void requireVoidingStillPending_isNoOp_whenNoRecordOrStillPending() {
    when(repository.findByInvoiceId(INVOICE_ID)).thenReturn(Optional.empty());
    service.requireVoidingStillPending(INVOICE_ID); // no throw

    SifenNumberVoidingEvent pending = new SifenNumberVoidingEvent();
    pending.setStatus(SifenNumberVoidingStatus.PENDING);
    when(repository.findByInvoiceId(INVOICE_ID)).thenReturn(Optional.of(pending));
    service.requireVoidingStillPending(INVOICE_ID); // no throw
  }

  @Test
  void requireVoidingStillPending_throws_onceSifenApprovedTheVoiding() {
    SifenNumberVoidingEvent approved = new SifenNumberVoidingEvent();
    approved.setStatus(SifenNumberVoidingStatus.APPROVED);
    when(repository.findByInvoiceId(INVOICE_ID)).thenReturn(Optional.of(approved));

    org.assertj.core.api.Assertions.assertThatThrownBy(
            () -> service.requireVoidingStillPending(INVOICE_ID))
        .isInstanceOf(org.springframework.web.server.ResponseStatusException.class)
        .hasMessageContaining("SIFEN_NUMBER_ALREADY_VOIDED");
  }

  @Test
  void cancelPendingForInvoice_marksAPendingRecordCancelled() {
    SifenNumberVoidingEvent pending = new SifenNumberVoidingEvent();
    pending.setStatus(SifenNumberVoidingStatus.PENDING);
    when(repository.findByInvoiceId(INVOICE_ID)).thenReturn(Optional.of(pending));

    service.cancelPendingForInvoice(INVOICE_ID);

    assertThat(pending.getStatus()).isEqualTo(SifenNumberVoidingStatus.CANCELLED);
  }

  @Test
  void cancelPendingForInvoice_leavesANonPendingRecordUntouched() {
    SifenNumberVoidingEvent submitted = new SifenNumberVoidingEvent();
    submitted.setStatus(SifenNumberVoidingStatus.REJECTED);
    when(repository.findByInvoiceId(INVOICE_ID)).thenReturn(Optional.of(submitted));

    service.cancelPendingForInvoice(INVOICE_ID);

    assertThat(submitted.getStatus()).isEqualTo(SifenNumberVoidingStatus.REJECTED);
  }

  /** Idempotency: a lease-related retry or reconciler pass must never double-record. */
  @Test
  void recordPendingForRejectedInvoice_isIdempotent_whenARowAlreadyExists() {
    when(repository.findByInvoiceId(INVOICE_ID))
        .thenReturn(Optional.of(new SifenNumberVoidingEvent()));

    service.recordPendingForRejectedInvoice(TENANT_ID, INVOICE_ID);

    verify(repository, never()).save(any());
    verify(invoiceRepository, never()).findByIdAndTenant_Id(anyLong(), anyLong());
  }

  @Test
  void listForTenant_mapsRowsToResponses() {
    SifenNumberVoidingEvent event = new SifenNumberVoidingEvent();
    event.setId(5L);
    event.setDocumentType(SifenDocumentType.FACTURA);
    event.setRangeFrom(10);
    event.setRangeTo(10);
    event.setReason("Motivo de prueba suficientemente largo");
    event.setStatus(SifenNumberVoidingStatus.PENDING);
    event.setDeadlineDate(LocalDate.of(2026, 9, 15));
    event.setCreatedAt(LocalDateTime.of(2026, 8, 13, 10, 0));
    when(repository.findByTenantIdOrderByDeadlineDateAsc(TENANT_ID)).thenReturn(List.of(event));

    List<com.cursorpoc.backend.web.dto.SifenNumberVoidingEventResponse> out =
        service.listForTenant(TENANT_ID);

    assertThat(out).hasSize(1);
    assertThat(out.get(0).id()).isEqualTo(5L);
    assertThat(out.get(0).status()).isEqualTo("PENDING");
    assertThat(out.get(0).rangeFrom()).isEqualTo(10);
  }

  @Test
  void submit_recordsApprovedResult() {
    SifenNumberVoidingEvent event = new SifenNumberVoidingEvent();
    event.setId(7L);
    event.setTenantId(TENANT_ID);
    event.setFiscalStamp(stamp());
    event.setDocumentType(SifenDocumentType.FACTURA);
    event.setRangeFrom(10);
    event.setRangeTo(10);
    event.setStatus(SifenNumberVoidingStatus.PENDING);
    event.setDeadlineDate(LocalDate.of(2026, 9, 15));
    event.setCreatedAt(LocalDateTime.now());
    when(repository.findByIdAndTenantId(7L, TENANT_ID))
        .thenReturn(Optional.of(event))
        .thenReturn(Optional.of(event));

    when(eventXmlService.buildNumberVoidingEvent(
            anyString(),
            anyInt(),
            anyInt(),
            eq(SifenDocumentType.FACTURA),
            anyLong(),
            anyLong(),
            anyString(),
            anyLong(),
            any()))
        .thenReturn(newDocument());
    when(signingService.signEvent(eq(TENANT_ID), any())).thenReturn(newDocument());
    when(eventClient.send(eq(TENANT_ID), anyString(), eq("number-voiding")))
        .thenReturn(
            Optional.of(
                new SifenSubmissionResult(
                    SifenSubmissionStatus.APPROVED,
                    "999",
                    "0600",
                    "Aprobado",
                    LocalDateTime.now())));

    var result = service.submit(TENANT_ID, 7L, "Motivo suficientemente largo para el evento");

    assertThat(result.status()).isEqualTo("APPROVED");
    assertThat(event.getStatus()).isEqualTo(SifenNumberVoidingStatus.APPROVED);
    assertThat(event.getSubmittedAt()).isNotNull();
  }

  @Test
  void submit_throwsBadGateway_whenSifenNeverResponds() {
    SifenNumberVoidingEvent event = new SifenNumberVoidingEvent();
    event.setId(7L);
    event.setTenantId(TENANT_ID);
    event.setFiscalStamp(stamp());
    event.setDocumentType(SifenDocumentType.FACTURA);
    event.setRangeFrom(10);
    event.setRangeTo(10);
    event.setStatus(SifenNumberVoidingStatus.PENDING);
    when(repository.findByIdAndTenantId(7L, TENANT_ID)).thenReturn(Optional.of(event));
    when(eventXmlService.buildNumberVoidingEvent(
            anyString(),
            anyInt(),
            anyInt(),
            eq(SifenDocumentType.FACTURA),
            anyLong(),
            anyLong(),
            anyString(),
            anyLong(),
            any()))
        .thenReturn(newDocument());
    when(signingService.signEvent(eq(TENANT_ID), any())).thenReturn(newDocument());
    when(eventClient.send(eq(TENANT_ID), anyString(), eq("number-voiding")))
        .thenReturn(Optional.empty());

    assertThatThrownBy(
            () -> service.submit(TENANT_ID, 7L, "Motivo suficientemente largo para el evento"))
        .isInstanceOf(ResponseStatusException.class)
        .extracting("statusCode")
        .isEqualTo(HttpStatus.BAD_GATEWAY);
  }

  // ── Follow-up: auto-void the invoice + invoice-scoped submit ─────────────────────────────

  @Test
  void statusForInvoice_returnsTheRecordedStatusOrEmpty() {
    SifenNumberVoidingEvent e = new SifenNumberVoidingEvent();
    e.setStatus(SifenNumberVoidingStatus.PENDING);
    when(repository.findByInvoiceId(INVOICE_ID)).thenReturn(Optional.of(e));
    assertThat(service.statusForInvoice(INVOICE_ID)).contains(SifenNumberVoidingStatus.PENDING);

    when(repository.findByInvoiceId(INVOICE_ID)).thenReturn(Optional.empty());
    assertThat(service.statusForInvoice(INVOICE_ID)).isEmpty();
  }

  private SifenNumberVoidingEvent pendingEventForInvoice() {
    SifenNumberVoidingEvent event = new SifenNumberVoidingEvent();
    event.setId(7L);
    event.setInvoiceId(INVOICE_ID);
    event.setDocumentType(SifenDocumentType.FACTURA);
    event.setRangeFrom(42);
    event.setRangeTo(42);
    event.setStatus(SifenNumberVoidingStatus.PENDING);
    event.setDeadlineDate(LocalDate.of(2026, 9, 15));
    event.setCreatedAt(LocalDateTime.now());
    return event;
  }

  @Test
  void recordSubmissionResult_approvedWithInvoice_voidsTheInvoice() {
    SifenNumberVoidingEvent event = pendingEventForInvoice();
    when(repository.findByIdAndTenantId(7L, TENANT_ID)).thenReturn(Optional.of(event));
    Invoice inv = new Invoice();
    inv.setStatus(InvoiceStatus.ISSUED);
    when(invoiceRepository.findByIdAndTenant_Id(INVOICE_ID, TENANT_ID))
        .thenReturn(Optional.of(inv));

    service.recordSubmissionResult(
        TENANT_ID,
        7L,
        "Motivo suficientemente largo para el evento",
        new SifenSubmissionResult(
            SifenSubmissionStatus.APPROVED, "P123", "0600", "Aprobado", LocalDateTime.now()));

    assertThat(event.getStatus()).isEqualTo(SifenNumberVoidingStatus.APPROVED);
    assertThat(inv.getStatus()).isEqualTo(InvoiceStatus.VOIDED);
    assertThat(inv.getVoidReason()).contains("P123");
  }

  @Test
  void recordSubmissionResult_rejected_leavesTheInvoiceUntouched() {
    SifenNumberVoidingEvent event = pendingEventForInvoice();
    when(repository.findByIdAndTenantId(7L, TENANT_ID)).thenReturn(Optional.of(event));

    service.recordSubmissionResult(
        TENANT_ID,
        7L,
        "Motivo suficientemente largo para el evento",
        new SifenSubmissionResult(
            SifenSubmissionStatus.REJECTED, null, "4004", "Rechazado", LocalDateTime.now()));

    assertThat(event.getStatus()).isEqualTo(SifenNumberVoidingStatus.REJECTED);
    verify(invoiceRepository, never()).findByIdAndTenant_Id(anyLong(), anyLong());
  }

  @Test
  void submitForInvoice_throws_whenInvoiceIsNotRejected() {
    Invoice inv = new Invoice();
    inv.setSifenSubmissionStatus(SifenSubmissionStatus.APPROVED);
    when(invoiceRepository.findByIdAndTenant_Id(INVOICE_ID, TENANT_ID))
        .thenReturn(Optional.of(inv));

    assertThatThrownBy(
            () ->
                service.submitForInvoice(
                    TENANT_ID, INVOICE_ID, "Motivo suficientemente largo para el evento"))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("INVOICE_NOT_REJECTED");
    verify(repository, never()).save(any());
  }

  @Test
  void submit_rejectsResubmission_whenAlreadyApproved() {
    SifenNumberVoidingEvent event = new SifenNumberVoidingEvent();
    event.setId(7L);
    event.setStatus(SifenNumberVoidingStatus.APPROVED);
    when(repository.findByIdAndTenantId(7L, TENANT_ID)).thenReturn(Optional.of(event));

    assertThatThrownBy(() -> service.submit(TENANT_ID, 7L, "Motivo suficientemente largo"))
        .isInstanceOf(ResponseStatusException.class)
        .extracting("statusCode")
        .isEqualTo(HttpStatus.CONFLICT);
  }

  private static Document newDocument() {
    try {
      DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
      factory.setNamespaceAware(true);
      return factory.newDocumentBuilder().newDocument();
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }
}
