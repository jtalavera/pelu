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
import com.cursorpoc.backend.domain.enums.SifenClientIdentificationType;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.repository.InvoiceRepository;
import com.cursorpoc.backend.web.dto.InvoiceClientIdentificationRequest;
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
 * SIFEN HU-11: exercises {@link SifenInvoiceClientIdentificationService}'s orchestration — AC-01
 * eligibility, AC-02 minimum fields, AC-03 (empresa requires a valid RUC), AC-04 (exterior requires
 * address + a supported country), AC-05 (SIFEN approves -> identified + client fields updated),
 * AC-06 (SIFEN rejects -> untouched, reason recorded). Real SIFEN approval of a nomination event
 * could not be observed live during this story (see PROGRESS.md) — same limitation, same testing
 * strategy as {@code SifenInvoiceCancellationServiceTest}.
 */
@ExtendWith(MockitoExtension.class)
class SifenInvoiceClientIdentificationServiceTest {

  private static final long TENANT_ID = 1L;
  private static final long INVOICE_ID = 100L;
  private static final long USER_ID = 7L;
  private static final String USER_EMAIL = "isabelzymanscki@gmail.com";

  @Mock private InvoiceRepository invoiceRepository;
  @Mock private SifenInvoiceHeaderService headerService;
  @Mock private SifenDocumentSigningService signingService;
  @Mock private SifenEventClient eventClient;

  private final SifenClientIdentificationEventXmlService eventXmlService =
      new SifenClientIdentificationEventXmlService();

  private SifenInvoiceClientIdentificationService service;
  private Invoice invoice;

  @BeforeEach
  void setUp() {
    service =
        new SifenInvoiceClientIdentificationService(
            invoiceRepository,
            headerService,
            eventXmlService,
            signingService,
            eventClient,
            new FemmeTimeProperties());

    invoice = new Invoice();
    invoice.setSifenControlNumber("01011371528001001999990122026072811234567800");
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.APPROVED);

    lenient()
        .when(invoiceRepository.findByIdAndTenant_Id(INVOICE_ID, TENANT_ID))
        .thenReturn(Optional.of(invoice));
    lenient().when(headerService.isReceiverUnidentified(invoice)).thenReturn(true);
    lenient()
        .when(signingService.signEvent(anyLong(), any(Document.class)))
        .thenAnswer(inv -> inv.getArgument(1));
  }

  private static InvoiceClientIdentificationRequest personRequest() {
    return new InvoiceClientIdentificationRequest(
        SifenClientIdentificationType.PERSON, null, "4123456", "María Duarte", null, null);
  }

  private static InvoiceClientIdentificationRequest companyRequest(String ruc) {
    return new InvoiceClientIdentificationRequest(
        SifenClientIdentificationType.COMPANY, ruc, null, "Comercial ABC S.A.", null, null);
  }

  private static InvoiceClientIdentificationRequest foreignRequest(
      String address, String countryCode) {
    return new InvoiceClientIdentificationRequest(
        SifenClientIdentificationType.FOREIGN,
        null,
        "AB123456",
        "John Smith",
        address,
        countryCode);
  }

  @Test
  void identifyClient_whenSifenApproves_marksIdentifiedAndUpdatesClientFields() {
    when(eventClient.send(eq(TENANT_ID), anyString(), anyString()))
        .thenReturn(
            Optional.of(
                new SifenSubmissionResult(
                    SifenSubmissionStatus.APPROVED,
                    "123123123",
                    "0600",
                    "Evento registrado correctamente",
                    LocalDateTime.now())));

    SifenSubmissionResult result =
        service.identifyClient(TENANT_ID, INVOICE_ID, USER_ID, USER_EMAIL, personRequest());

    assertThat(result.status()).isEqualTo(SifenSubmissionStatus.APPROVED);
    assertThat(invoice.isSifenClientIdentified()).isTrue();
    assertThat(invoice.getClientDisplayName()).isEqualTo("María Duarte");
    assertThat(invoice.getClientIdentityDocumentOverride()).isEqualTo("4123456");
    // Approval never changes the overall submission status (unlike HU-10's cancellation).
    assertThat(invoice.getSifenSubmissionStatus()).isEqualTo(SifenSubmissionStatus.APPROVED);
  }

  @Test
  void identifyClient_whenSifenRejects_leavesInvoiceUntouchedButRecordsTheReason() {
    when(eventClient.send(eq(TENANT_ID), anyString(), anyString()))
        .thenReturn(
            Optional.of(
                new SifenSubmissionResult(
                    SifenSubmissionStatus.REJECTED,
                    null,
                    "4520",
                    "Datos del receptor inconsistentes",
                    LocalDateTime.now())));

    SifenSubmissionResult result =
        service.identifyClient(TENANT_ID, INVOICE_ID, USER_ID, USER_EMAIL, personRequest());

    assertThat(result.status()).isEqualTo(SifenSubmissionStatus.REJECTED);
    assertThat(invoice.isSifenClientIdentified()).isFalse();
    assertThat(invoice.getClientDisplayName()).isNull();
    assertThat(invoice.getSifenClientIdentificationResultCode()).isEqualTo("4520");
    assertThat(invoice.getSifenClientIdentificationMessage())
        .isEqualTo("Datos del receptor inconsistentes");
  }

  @Test
  void identifyClient_alwaysRecordsWhoRequestedItAndTheSubmittedData() {
    when(eventClient.send(eq(TENANT_ID), anyString(), anyString()))
        .thenReturn(
            Optional.of(
                new SifenSubmissionResult(
                    SifenSubmissionStatus.REJECTED, null, "4520", "x", LocalDateTime.now())));

    service.identifyClient(TENANT_ID, INVOICE_ID, USER_ID, USER_EMAIL, personRequest());

    assertThat(invoice.getSifenClientIdentificationRequestedByUserId()).isEqualTo(USER_ID);
    assertThat(invoice.getSifenClientIdentificationRequestedByEmail()).isEqualTo(USER_EMAIL);
    assertThat(invoice.getSifenClientIdentificationRequestedAt()).isNotNull();
    assertThat(invoice.getSifenClientIdentificationClientType()).isEqualTo("PERSON");
    assertThat(invoice.getSifenClientIdentificationName()).isEqualTo("María Duarte");
  }

  @Test
  void identifyClient_rejectsAnInvoiceThatWasNeverApproved() {
    invoice.setSifenSubmissionStatus(SifenSubmissionStatus.PENDING_VERIFICATION);

    assertThatThrownBy(
            () ->
                service.identifyClient(TENANT_ID, INVOICE_ID, USER_ID, USER_EMAIL, personRequest()))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_INVOICE_NOT_APPROVED");
    verifyNoEventSent();
  }

  @Test
  void identifyClient_rejectsAnInvoiceAlreadyIdentified() {
    invoice.setSifenClientIdentified(true);

    assertThatThrownBy(
            () ->
                service.identifyClient(TENANT_ID, INVOICE_ID, USER_ID, USER_EMAIL, personRequest()))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_INVOICE_CLIENT_ALREADY_IDENTIFIED");
    verifyNoEventSent();
  }

  @Test
  void identifyClient_rejectsAnInvoiceThatAlreadyHasClientData() {
    when(headerService.isReceiverUnidentified(invoice)).thenReturn(false);

    assertThatThrownBy(
            () ->
                service.identifyClient(TENANT_ID, INVOICE_ID, USER_ID, USER_EMAIL, personRequest()))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_INVOICE_CLIENT_ALREADY_IDENTIFIED");
    verifyNoEventSent();
  }

  /**
   * AC-03: a company without a RUC, or with a malformed one, is rejected before any network call.
   */
  @Test
  void identifyClient_company_requiresAValidRuc() {
    assertThatThrownBy(
            () ->
                service.identifyClient(
                    TENANT_ID, INVOICE_ID, USER_ID, USER_EMAIL, companyRequest(null)))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_CLIENT_IDENTIFICATION_RUC_INVALID");
    verifyNoEventSent();
  }

  @Test
  void identifyClient_company_rejectsAMalformedRuc() {
    assertThatThrownBy(
            () ->
                service.identifyClient(
                    TENANT_ID, INVOICE_ID, USER_ID, USER_EMAIL, companyRequest("not-a-ruc")))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_CLIENT_IDENTIFICATION_RUC_INVALID");
    verifyNoEventSent();
  }

  @Test
  void identifyClient_company_acceptsAValidRuc() {
    when(eventClient.send(eq(TENANT_ID), anyString(), anyString()))
        .thenReturn(
            Optional.of(
                new SifenSubmissionResult(
                    SifenSubmissionStatus.APPROVED, "1", "0600", "ok", LocalDateTime.now())));

    service.identifyClient(
        TENANT_ID, INVOICE_ID, USER_ID, USER_EMAIL, companyRequest("80000005-6"));

    assertThat(invoice.getClientRucOverride()).isEqualTo("80000005-6");
  }

  /** AC-04: a foreign client without an address is rejected before any network call. */
  @Test
  void identifyClient_foreign_requiresAnAddress() {
    assertThatThrownBy(
            () ->
                service.identifyClient(
                    TENANT_ID, INVOICE_ID, USER_ID, USER_EMAIL, foreignRequest(null, "USA")))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_CLIENT_IDENTIFICATION_ADDRESS_REQUIRED");
    verifyNoEventSent();
  }

  @Test
  void identifyClient_foreign_requiresASupportedCountry() {
    assertThatThrownBy(
            () ->
                service.identifyClient(
                    TENANT_ID,
                    INVOICE_ID,
                    USER_ID,
                    USER_EMAIL,
                    foreignRequest("5th Avenue 123", "ZZZ")))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_CLIENT_IDENTIFICATION_COUNTRY_INVALID");
    verifyNoEventSent();
  }

  @Test
  void identifyClient_foreign_acceptsAnAddressAndSupportedCountry() {
    when(eventClient.send(eq(TENANT_ID), anyString(), anyString()))
        .thenReturn(
            Optional.of(
                new SifenSubmissionResult(
                    SifenSubmissionStatus.APPROVED, "1", "0600", "ok", LocalDateTime.now())));

    service.identifyClient(
        TENANT_ID,
        INVOICE_ID,
        USER_ID,
        USER_EMAIL,
        foreignRequest("5th Avenue 123, New York", "usa"));

    assertThat(invoice.getSifenClientIdentificationAddress()).isEqualTo("5th Avenue 123, New York");
    assertThat(invoice.getSifenClientIdentificationCountryCode()).isEqualTo("USA");
  }

  @Test
  void identifyClient_person_requiresARucOrIdentityDocument() {
    var request =
        new InvoiceClientIdentificationRequest(
            SifenClientIdentificationType.PERSON, null, null, "María Duarte", null, null);

    assertThatThrownBy(
            () -> service.identifyClient(TENANT_ID, INVOICE_ID, USER_ID, USER_EMAIL, request))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_CLIENT_IDENTIFICATION_DOCUMENT_REQUIRED");
    verifyNoEventSent();
  }

  @Test
  void identifyClient_throwsWhenSifenNeverResponds() {
    when(eventClient.send(eq(TENANT_ID), anyString(), anyString())).thenReturn(Optional.empty());

    assertThatThrownBy(
            () ->
                service.identifyClient(TENANT_ID, INVOICE_ID, USER_ID, USER_EMAIL, personRequest()))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_CLIENT_IDENTIFICATION_NO_RESPONSE");
    // AC-05/AC-06: the attempt is still on record even though SIFEN never answered.
    assertThat(invoice.getSifenClientIdentificationRequestedAt()).isNotNull();
    assertThat(invoice.isSifenClientIdentified()).isFalse();
  }

  @Test
  void identifyClient_signsTheEventBuiltFromTheInvoicesOwnControlNumber() {
    when(eventClient.send(eq(TENANT_ID), anyString(), anyString()))
        .thenReturn(
            Optional.of(
                new SifenSubmissionResult(
                    SifenSubmissionStatus.APPROVED, "1", "0600", "ok", LocalDateTime.now())));

    service.identifyClient(TENANT_ID, INVOICE_ID, USER_ID, USER_EMAIL, personRequest());

    ArgumentCaptor<Document> captor = ArgumentCaptor.forClass(Document.class);
    verify(signingService).signEvent(eq(TENANT_ID), captor.capture());
    String xml = SifenDocumentXmlService.serialize(captor.getValue());
    assertThat(xml).contains(invoice.getSifenControlNumber());
    assertThat(xml).contains("María Duarte");
  }

  private void verifyNoEventSent() {
    verify(signingService, never()).signEvent(anyLong(), any());
    verify(eventClient, never()).send(anyLong(), anyString(), anyString());
  }
}
