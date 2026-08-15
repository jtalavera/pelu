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
