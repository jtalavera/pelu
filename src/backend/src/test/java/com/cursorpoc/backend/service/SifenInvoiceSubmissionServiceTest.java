package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.repository.InvoiceRepository;
import java.time.LocalDateTime;
import java.util.Optional;
import javax.xml.parsers.DocumentBuilderFactory;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;
import org.w3c.dom.Document;

@ExtendWith(MockitoExtension.class)
class SifenInvoiceSubmissionServiceTest {

  private static final long TENANT_ID = 1L;
  private static final long INVOICE_ID = 100L;

  /**
   * The service computes "now" in the business zone ({@link FemmeTimeProperties}), never the JVM
   * default zone — boundary-sensitive timestamps below must use this same zone, or they only pass
   * by coincidence on a machine whose default zone happens to match (as this repo's local dev
   * default does, unlike CI runners, which default to UTC).
   */
  private static final java.time.ZoneId BUSINESS_ZONE = new FemmeTimeProperties().zoneId();

  @Mock private InvoiceRepository invoiceRepository;
  @Mock private SifenDocumentSigningService signingService;
  @Mock private SifenDocumentReceptionClient receptionClient;
  @Mock private SifenDocumentQueryClient queryClient;

  private SifenInvoiceSubmissionService service;
  private Invoice invoice;

  @BeforeEach
  void setUp() {
    SifenInvoiceSubmissionPersistenceService persistence =
        new SifenInvoiceSubmissionPersistenceService(invoiceRepository, new FemmeTimeProperties());
    service =
        new SifenInvoiceSubmissionService(
            persistence, signingService, receptionClient, queryClient, new FemmeTimeProperties());
    invoice = new Invoice();
    // Mirrors the real flow: SifenInvoiceHeaderService (called inside the real signInvoice, not
    // this mock) persists the CDC onto the invoice the first time a document is built (HU-02) — so
    // by the time an invoice could ever reach PENDING_VERIFICATION for real, it always has one.
    invoice.setSifenControlNumber("cdc-123");
    lenient()
        .when(invoiceRepository.findByIdAndTenant_Id(INVOICE_ID, TENANT_ID))
        .thenReturn(Optional.of(invoice));
    lenient()
        .when(signingService.signInvoice(eq(TENANT_ID), eq(INVOICE_ID), any()))
        .thenReturn(
            new SifenSignedDocument(
                minimalDocument(),
                "cdc-123",
                LocalDateTime.now(),
                "https://ekuatia.set.gov.py/consultas-test/qr?nVersion=150",
                "https://ekuatia.set.gov.py/consultas-test/"));
    // AC-05 default: SIFEN gives no answer when queried, so submit() falls through to a normal
    // (re)send for every pre-existing test below that doesn't care about the query step itself.
    lenient().when(queryClient.query(eq(TENANT_ID), any())).thenReturn(Optional.empty());
  }

  /** AC-02: an approved result, including the protocol number, is persisted on the invoice. */
  @Test
  void submit_recordsApprovedResult() {
    when(receptionClient.send(eq(TENANT_ID), any()))
        .thenReturn(
            Optional.of(
                new SifenSubmissionResult(
                    SifenSubmissionStatus.APPROVED, "1234567890", "0260", "Autorizado", now())));

    SifenSubmissionResult result = service.submit(TENANT_ID, INVOICE_ID);

    assertThat(result.status()).isEqualTo(SifenSubmissionStatus.APPROVED);
    assertThat(invoice.getSifenSubmissionStatus()).isEqualTo(SifenSubmissionStatus.APPROVED);
    assertThat(invoice.getSifenSubmissionProtocolNumber()).isEqualTo("1234567890");
    assertThat(invoice.getSifenSubmittedAt()).isNotNull();
    // SIFEN HU-08: the QR data the signing step produced is persisted regardless of the outcome
    // SIFEN reports back — it's a property of the document sent, not of the response.
    assertThat(invoice.getSifenQrUrl())
        .isEqualTo("https://ekuatia.set.gov.py/consultas-test/qr?nVersion=150");
    assertThat(invoice.getSifenPublicConsultationUrl())
        .isEqualTo("https://ekuatia.set.gov.py/consultas-test/");
  }

  /** AC-03: an approved-with-observation result is persisted distinctly from a plain approval. */
  @Test
  void submit_recordsApprovedWithObservationResult() {
    when(receptionClient.send(eq(TENANT_ID), any()))
        .thenReturn(
            Optional.of(
                new SifenSubmissionResult(
                    SifenSubmissionStatus.APPROVED_WITH_OBSERVATION,
                    "1234567890",
                    "0301",
                    "Observación menor",
                    now())));

    SifenSubmissionResult result = service.submit(TENANT_ID, INVOICE_ID);

    assertThat(result.status()).isEqualTo(SifenSubmissionStatus.APPROVED_WITH_OBSERVATION);
    assertThat(invoice.getSifenSubmissionStatus())
        .isEqualTo(SifenSubmissionStatus.APPROVED_WITH_OBSERVATION);
    assertThat(invoice.getSifenSubmissionMessage()).isEqualTo("Observación menor");
  }

  /** AC-04: a rejected result and its reason are persisted. */
  @Test
  void submit_recordsRejectedResult() {
    when(receptionClient.send(eq(TENANT_ID), any()))
        .thenReturn(
            Optional.of(
                new SifenSubmissionResult(
                    SifenSubmissionStatus.REJECTED, null, "0160", "XML Mal Formado.", now())));

    SifenSubmissionResult result = service.submit(TENANT_ID, INVOICE_ID);

    assertThat(result.status()).isEqualTo(SifenSubmissionStatus.REJECTED);
    assertThat(invoice.getSifenSubmissionStatus()).isEqualTo(SifenSubmissionStatus.REJECTED);
    assertThat(invoice.getSifenSubmissionMessage()).isEqualTo("XML Mal Formado.");
  }

  /**
   * AC-05: no response at all (comms failure) is marked pending verification, and — unlike the
   * other outcomes — never sets sifenSubmittedAt, since no response was actually received.
   */
  @Test
  void submit_marksPendingVerification_whenNoResponseIsReceived() {
    when(receptionClient.send(eq(TENANT_ID), any())).thenReturn(Optional.empty());

    SifenSubmissionResult result = service.submit(TENANT_ID, INVOICE_ID);

    assertThat(result.status()).isEqualTo(SifenSubmissionStatus.PENDING_VERIFICATION);
    assertThat(invoice.getSifenSubmissionStatus())
        .isEqualTo(SifenSubmissionStatus.PENDING_VERIFICATION);
    assertThat(invoice.getSifenSubmittedAt()).isNull();
  }

  /** AC-06: an already-approved invoice can never be sent again. */
  @Test
  void submit_rejects_whenInvoiceAlreadyApproved() {
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.APPROVED);

    assertThatThrownBy(() -> service.submit(TENANT_ID, INVOICE_ID))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_INVOICE_ALREADY_APPROVED");

    verify(receptionClient, never()).send(anyLong(), any());
  }

  /** AC-06: same guard applies to "Aprobado con observación", not just a plain approval. */
  @Test
  void submit_rejects_whenInvoiceApprovedWithObservation() {
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.APPROVED_WITH_OBSERVATION);

    assertThatThrownBy(() -> service.submit(TENANT_ID, INVOICE_ID))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_INVOICE_ALREADY_APPROVED");
  }

  /** AC-07: signed more than 72h ago and never actually sent before -> blocked. */
  @Test
  void submit_rejects_whenSignedMoreThan72HoursAgoAndNeverReceivedAResponse() {
    invoice.setSifenSignedAt(LocalDateTime.now(BUSINESS_ZONE).minusHours(73));

    assertThatThrownBy(() -> service.submit(TENANT_ID, INVOICE_ID))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_SIGNATURE_EXPIRED");

    verify(receptionClient, never()).send(anyLong(), any());
  }

  /** AC-07: comfortably under 72h since signing is allowed. */
  @Test
  void submit_allows_whenSignedLessThan72HoursAgo() {
    invoice.setSifenSignedAt(LocalDateTime.now(BUSINESS_ZONE).minusHours(71));
    when(receptionClient.send(eq(TENANT_ID), any())).thenReturn(Optional.empty());

    service.submit(TENANT_ID, INVOICE_ID);

    verify(receptionClient, times(1)).send(eq(TENANT_ID), any());
  }

  /**
   * AC-07 is scoped to invoices that were never actually sent before: a rejected retry, even past
   * 72h since the original signature, isn't blocked by this guard (a stale rejected/pending
   * document past 72h is a different concern — HU-07's status check — not this one).
   */
  @Test
  void submit_allowsRetry_whenSignedMoreThan72HoursAgoButAlreadyReceivedAResponseBefore() {
    invoice.setSifenSignedAt(LocalDateTime.now().minusHours(100));
    invoice.setSifenSubmittedAt(LocalDateTime.now().minusHours(90));
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.REJECTED);
    when(receptionClient.send(eq(TENANT_ID), any()))
        .thenReturn(
            Optional.of(
                new SifenSubmissionResult(
                    SifenSubmissionStatus.REJECTED, null, "0160", "still broken", now())));

    SifenSubmissionResult result = service.submit(TENANT_ID, INVOICE_ID);

    assertThat(result.status()).isEqualTo(SifenSubmissionStatus.REJECTED);
  }

  /** The first submission persists sifenSignedAt; a later retry reuses it, not a fresh "now". */
  @Test
  void submit_persistsSignedAtOnce_andReusesItOnRetry() {
    when(receptionClient.send(eq(TENANT_ID), any())).thenReturn(Optional.empty());

    service.submit(TENANT_ID, INVOICE_ID);
    LocalDateTime firstSignedAt = invoice.getSifenSignedAt();
    assertThat(firstSignedAt).isNotNull();

    service.submit(TENANT_ID, INVOICE_ID);

    assertThat(invoice.getSifenSignedAt()).isEqualTo(firstSignedAt);
    verify(signingService, times(2)).signInvoice(TENANT_ID, INVOICE_ID, firstSignedAt);
  }

  @Test
  void submit_throwsInvoiceNotFound_whenInvoiceDoesNotBelongToTenant() {
    when(invoiceRepository.findByIdAndTenant_Id(999L, TENANT_ID)).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.submit(TENANT_ID, 999L))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("INVOICE_NOT_FOUND");
  }

  // --- HU-07 AC-01/AC-02/AC-03/AC-04: checkPendingStatus (manual "check status" button) ---

  /** AC-01: SIFEN confirms approval -> status updated, sifenSubmittedAt set. */
  @Test
  void checkPendingStatus_resolvesApproved_whenSifenFindsTheDocument() {
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.PENDING_VERIFICATION);
    when(queryClient.query(TENANT_ID, "cdc-123"))
        .thenReturn(
            Optional.of(
                new SifenQueryResult(
                    new SifenSubmissionResult(
                        SifenSubmissionStatus.APPROVED, null, "0422", "CDC encontrado", now()),
                    "<rContDe>...</rContDe>")));

    Optional<SifenSubmissionResult> result = service.checkPendingStatus(TENANT_ID, INVOICE_ID);

    assertThat(result).isPresent();
    assertThat(result.get().status()).isEqualTo(SifenSubmissionStatus.APPROVED);
    assertThat(invoice.getSifenSubmissionStatus()).isEqualTo(SifenSubmissionStatus.APPROVED);
    assertThat(invoice.getSifenSubmittedAt()).isNotNull();
    // AC-03: the full document content is stored when SIFEN confirms approval.
    assertThat(invoice.getSifenQueryDocumentContent()).isEqualTo("<rContDe>...</rContDe>");
  }

  /** AC-02: SIFEN doesn't recognize/rejected the CDC -> "No existe / Rechazado". */
  @Test
  void checkPendingStatus_resolvesRejected_whenSifenSaysNotFoundOrRejected() {
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.PENDING_VERIFICATION);
    when(queryClient.query(TENANT_ID, "cdc-123"))
        .thenReturn(
            Optional.of(
                new SifenQueryResult(
                    new SifenSubmissionResult(
                        SifenSubmissionStatus.REJECTED,
                        null,
                        "0420",
                        "Documento No Existe en SIFEN o ha sido Rechazado",
                        now()),
                    null)));

    Optional<SifenSubmissionResult> result = service.checkPendingStatus(TENANT_ID, INVOICE_ID);

    assertThat(result).isPresent();
    assertThat(result.get().status()).isEqualTo(SifenSubmissionStatus.REJECTED);
    assertThat(invoice.getSifenSubmissionStatus()).isEqualTo(SifenSubmissionStatus.REJECTED);
    assertThat(invoice.getSifenQueryDocumentContent()).isNull();
  }

  /** SIFEN still gives no interpretable answer -> invoice stays untouched, still pending. */
  @Test
  void checkPendingStatus_returnsEmpty_whenSifenStillGivesNoAnswer() {
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.PENDING_VERIFICATION);
    when(queryClient.query(TENANT_ID, "cdc-123")).thenReturn(Optional.empty());

    Optional<SifenSubmissionResult> result = service.checkPendingStatus(TENANT_ID, INVOICE_ID);

    assertThat(result).isEmpty();
    assertThat(invoice.getSifenSubmissionStatus())
        .isEqualTo(SifenSubmissionStatus.PENDING_VERIFICATION);
    assertThat(invoice.getSifenSubmittedAt()).isNull();
  }

  /** AC-04's precondition: the manual check only ever makes sense on a pending invoice. */
  @Test
  void checkPendingStatus_throws_whenInvoiceIsNotPendingVerification() {
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.APPROVED);

    assertThatThrownBy(() -> service.checkPendingStatus(TENANT_ID, INVOICE_ID))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_INVOICE_NOT_PENDING_VERIFICATION");

    verify(queryClient, never()).query(anyLong(), any());
  }

  @Test
  void checkPendingStatus_throws_whenInvoiceHasNoControlNumber() {
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.PENDING_VERIFICATION);
    invoice.setSifenControlNumber(null);

    assertThatThrownBy(() -> service.checkPendingStatus(TENANT_ID, INVOICE_ID))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_INVOICE_MISSING_CONTROL_NUMBER");
  }

  // --- HU-07 AC-05: submit() checks status automatically before blindly resending ---

  /** A resolved query (Aprobado) short-circuits submit(): no fresh sign/send attempt. */
  @Test
  void submit_resolvesViaStatusCheck_andSkipsResend_whenPendingVerificationGetsAnAnswer() {
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.PENDING_VERIFICATION);
    when(queryClient.query(TENANT_ID, "cdc-123"))
        .thenReturn(
            Optional.of(
                new SifenQueryResult(
                    new SifenSubmissionResult(
                        SifenSubmissionStatus.APPROVED, null, "0422", "CDC encontrado", now()),
                    null)));

    SifenSubmissionResult result = service.submit(TENANT_ID, INVOICE_ID);

    assertThat(result.status()).isEqualTo(SifenSubmissionStatus.APPROVED);
    verify(signingService, never()).signInvoice(anyLong(), anyLong(), any());
    verify(receptionClient, never()).send(anyLong(), any());
  }

  /** No answer from the automatic check -> submit() falls through to a fresh resend attempt. */
  @Test
  void submit_fallsThroughToResend_whenPendingVerificationStatusCheckStillGivesNoAnswer() {
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.PENDING_VERIFICATION);
    when(receptionClient.send(eq(TENANT_ID), any()))
        .thenReturn(
            Optional.of(
                new SifenSubmissionResult(
                    SifenSubmissionStatus.REJECTED, null, "0160", "still broken", now())));

    SifenSubmissionResult result = service.submit(TENANT_ID, INVOICE_ID);

    verify(queryClient, times(1)).query(TENANT_ID, "cdc-123");
    verify(signingService, times(1)).signInvoice(eq(TENANT_ID), eq(INVOICE_ID), any());
    assertThat(result.status()).isEqualTo(SifenSubmissionStatus.REJECTED);
  }

  private static LocalDateTime now() {
    return LocalDateTime.now();
  }

  private static Document minimalDocument() {
    try {
      DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
      factory.setNamespaceAware(true);
      Document doc = factory.newDocumentBuilder().newDocument();
      doc.appendChild(doc.createElement("rDE"));
      return doc;
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }
}
