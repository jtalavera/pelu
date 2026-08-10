package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.repository.InvoiceRepository;
import java.time.LocalDateTime;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;
import org.w3c.dom.Document;

/**
 * SIFEN HU-10: exercises {@link SifenInvoiceCancellationService}'s orchestration — AC-01/AC-02
 * eligibility, AC-03 (SIFEN approves -> CANCELLED), AC-04 (SIFEN rejects -> status untouched), and
 * AC-05 (audit fields persisted either way). Real SIFEN approval of a cancellation could not be
 * observed live during this story (see PROGRESS.md), so the "approves" branch here is exercised
 * with a mocked {@link SifenEventClient} — the same limitation, and the same testing strategy,
 * HU-06/HU-07's own submission/query services already documented for their own "Aprobado" branches.
 */
@ExtendWith(MockitoExtension.class)
class SifenInvoiceCancellationServiceTest {

  private static final long TENANT_ID = 1L;
  private static final long INVOICE_ID = 100L;
  private static final long USER_ID = 7L;
  private static final String USER_EMAIL = "isabelzymanscki@gmail.com";
  private static final String REASON = "Error en el monto facturado al cliente";

  /**
   * The service computes "now" in the business zone ({@link FemmeTimeProperties}), never the JVM
   * default zone — boundary-sensitive timestamps below must use this same zone, or they only pass
   * by coincidence on a machine whose default zone happens to match (as this repo's local dev
   * default does, unlike CI runners, which default to UTC).
   */
  private static final java.time.ZoneId BUSINESS_ZONE = new FemmeTimeProperties().zoneId();

  @Mock private InvoiceRepository invoiceRepository;
  @Mock private SifenDocumentSigningService signingService;
  @Mock private SifenEventClient eventClient;

  private final SifenCancellationEventXmlService eventXmlService =
      new SifenCancellationEventXmlService();

  private SifenInvoiceCancellationService service;
  private Invoice invoice;

  @BeforeEach
  void setUp() {
    service =
        new SifenInvoiceCancellationService(
            invoiceRepository,
            eventXmlService,
            signingService,
            eventClient,
            new FemmeTimeProperties());

    invoice = new Invoice();
    invoice.setSifenControlNumber("01011371528001001999990122026072811234567800");
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.APPROVED);
    invoice.setSifenSubmittedAt(LocalDateTime.now().minusHours(1));

    lenient()
        .when(invoiceRepository.findByIdAndTenant_Id(INVOICE_ID, TENANT_ID))
        .thenReturn(Optional.of(invoice));
    lenient()
        .when(signingService.signEvent(anyLong(), any(Document.class)))
        .thenAnswer(inv -> inv.getArgument(1));
  }

  @Test
  void cancel_whenSifenApproves_movesTheInvoiceToCancelled() {
    when(eventClient.send(eq(TENANT_ID), anyString(), anyString()))
        .thenReturn(
            Optional.of(
                new SifenSubmissionResult(
                    SifenSubmissionStatus.APPROVED,
                    "987654321",
                    "0600",
                    "Evento registrado correctamente",
                    LocalDateTime.now())));

    SifenSubmissionResult result =
        service.cancel(TENANT_ID, INVOICE_ID, USER_ID, USER_EMAIL, REASON);

    assertThat(result.status()).isEqualTo(SifenSubmissionStatus.APPROVED);
    assertThat(invoice.getSifenSubmissionStatus()).isEqualTo(SifenSubmissionStatus.CANCELLED);
    assertThat(invoice.getSifenCancellationResultCode()).isEqualTo("0600");
    assertThat(invoice.getSifenCancellationProtocolNumber()).isEqualTo("987654321");
    assertThat(invoice.getSifenCancellationMessage()).isEqualTo("Evento registrado correctamente");
  }

  @Test
  void cancel_whenSifenApprovesWithObservation_alsoMovesTheInvoiceToCancelled() {
    when(eventClient.send(eq(TENANT_ID), anyString(), anyString()))
        .thenReturn(
            Optional.of(
                new SifenSubmissionResult(
                    SifenSubmissionStatus.APPROVED_WITH_OBSERVATION,
                    "111222333",
                    "0600",
                    "Registrado con observación",
                    LocalDateTime.now())));

    service.cancel(TENANT_ID, INVOICE_ID, USER_ID, USER_EMAIL, REASON);

    assertThat(invoice.getSifenSubmissionStatus()).isEqualTo(SifenSubmissionStatus.CANCELLED);
  }

  @Test
  void cancel_whenSifenRejects_leavesThePreviousStatusUntouchedButRecordsTheReason() {
    when(eventClient.send(eq(TENANT_ID), anyString(), anyString()))
        .thenReturn(
            Optional.of(
                new SifenSubmissionResult(
                    SifenSubmissionStatus.REJECTED,
                    null,
                    "4009",
                    "Plazo de solicitud de cancelación de una FE extemporáneo",
                    LocalDateTime.now())));

    SifenSubmissionResult result =
        service.cancel(TENANT_ID, INVOICE_ID, USER_ID, USER_EMAIL, REASON);

    assertThat(result.status()).isEqualTo(SifenSubmissionStatus.REJECTED);
    assertThat(invoice.getSifenSubmissionStatus()).isEqualTo(SifenSubmissionStatus.APPROVED);
    assertThat(invoice.getSifenCancellationResultCode()).isEqualTo("4009");
    assertThat(invoice.getSifenCancellationMessage())
        .isEqualTo("Plazo de solicitud de cancelación de una FE extemporáneo");
  }

  @Test
  void cancel_alwaysRecordsWhoRequestedItAndWhenAndWhy_regardlessOfOutcome() {
    when(eventClient.send(eq(TENANT_ID), anyString(), anyString()))
        .thenReturn(
            Optional.of(
                new SifenSubmissionResult(
                    SifenSubmissionStatus.REJECTED, null, "4009", "x", LocalDateTime.now())));

    service.cancel(TENANT_ID, INVOICE_ID, USER_ID, USER_EMAIL, REASON);

    assertThat(invoice.getSifenCancellationRequestedByUserId()).isEqualTo(USER_ID);
    assertThat(invoice.getSifenCancellationRequestedByEmail()).isEqualTo(USER_EMAIL);
    assertThat(invoice.getSifenCancellationReason()).isEqualTo(REASON);
    assertThat(invoice.getSifenCancellationRequestedAt()).isNotNull();
  }

  @Test
  void cancel_rejectsAnInvoiceThatWasNeverApproved() {
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.PENDING_VERIFICATION);

    assertThatThrownBy(() -> service.cancel(TENANT_ID, INVOICE_ID, USER_ID, USER_EMAIL, REASON))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_INVOICE_NOT_APPROVED");
    verifyNoEventSent();
  }

  @Test
  void cancel_rejectsAnAlreadyCancelledInvoice() {
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.CANCELLED);

    assertThatThrownBy(() -> service.cancel(TENANT_ID, INVOICE_ID, USER_ID, USER_EMAIL, REASON))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_INVOICE_NOT_APPROVED");
    verifyNoEventSent();
  }

  @Test
  void cancel_rejectsARejectedInvoice() {
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.REJECTED);

    assertThatThrownBy(() -> service.cancel(TENANT_ID, INVOICE_ID, USER_ID, USER_EMAIL, REASON))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_INVOICE_NOT_APPROVED");
    verifyNoEventSent();
  }

  /**
   * AC-02: past the 48h window since sifenSubmittedAt (approval instant), cancellation is refused.
   */
  @Test
  void cancel_rejectsAnInvoicePastThe48HourWindow() {
    invoice.setSifenSubmittedAt(LocalDateTime.now(BUSINESS_ZONE).minusHours(49));

    assertThatThrownBy(() -> service.cancel(TENANT_ID, INVOICE_ID, USER_ID, USER_EMAIL, REASON))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_INVOICE_CANCELLATION_WINDOW_EXPIRED");
    verifyNoEventSent();
  }

  /** AC-02: right at the boundary (within 48h) still works. */
  @Test
  void cancel_allowsAnInvoiceJustWithinThe48HourWindow() {
    invoice.setSifenSubmittedAt(LocalDateTime.now(BUSINESS_ZONE).minusHours(47).minusMinutes(30));
    when(eventClient.send(eq(TENANT_ID), anyString(), anyString()))
        .thenReturn(
            Optional.of(
                new SifenSubmissionResult(
                    SifenSubmissionStatus.APPROVED, "1", "0600", "ok", LocalDateTime.now())));

    service.cancel(TENANT_ID, INVOICE_ID, USER_ID, USER_EMAIL, REASON);

    assertThat(invoice.getSifenSubmissionStatus()).isEqualTo(SifenSubmissionStatus.CANCELLED);
  }

  @Test
  void cancel_throwsWhenSifenNeverResponds() {
    when(eventClient.send(eq(TENANT_ID), anyString(), anyString())).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.cancel(TENANT_ID, INVOICE_ID, USER_ID, USER_EMAIL, REASON))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_CANCELLATION_NO_RESPONSE");
    // AC-05: the attempt is still on record even though SIFEN never answered.
    assertThat(invoice.getSifenCancellationRequestedAt()).isNotNull();
    assertThat(invoice.getSifenCancellationReason()).isEqualTo(REASON);
    assertThat(invoice.getSifenSubmissionStatus()).isEqualTo(SifenSubmissionStatus.APPROVED);
  }

  @Test
  void cancel_signsTheEventBuiltFromTheInvoicesOwnControlNumberAndReason() {
    when(eventClient.send(eq(TENANT_ID), anyString(), anyString()))
        .thenReturn(
            Optional.of(
                new SifenSubmissionResult(
                    SifenSubmissionStatus.APPROVED, "1", "0600", "ok", LocalDateTime.now())));

    service.cancel(TENANT_ID, INVOICE_ID, USER_ID, USER_EMAIL, REASON);

    ArgumentCaptor<Document> captor = ArgumentCaptor.forClass(Document.class);
    verify(signingService).signEvent(eq(TENANT_ID), captor.capture());
    Document eventDocument = captor.getValue();
    String xml = SifenDocumentXmlService.serialize(eventDocument);
    assertThat(xml).contains(invoice.getSifenControlNumber());
    assertThat(xml).contains(REASON);
  }

  private void verifyNoEventSent() {
    verify(signingService, never()).signEvent(anyLong(), any());
    verify(eventClient, never()).send(anyLong(), anyString(), anyString());
  }
}
