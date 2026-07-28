package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.domain.enums.SifenTaxAffectation;
import com.cursorpoc.backend.domain.enums.SifenTaxpayerType;
import java.io.InputStream;
import java.math.BigDecimal;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Enumeration;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;
import org.w3c.dom.Document;

@ExtendWith(MockitoExtension.class)
class SifenDocumentSigningServiceTest {

  private static final String FIXTURE_PASSWORD = "TestPass123!";
  private static final long TENANT_ID = 1L;
  private static final long INVOICE_ID = 100L;

  @Mock private SifenCertificateService certificateService;
  @Mock private SifenInvoiceHeaderService headerService;
  @Mock private SifenInvoiceDetailService detailService;

  private final SifenControlNumberService controlNumberService = new SifenControlNumberService();
  private final SifenDocumentXmlService xmlService = new SifenDocumentXmlService();

  private SifenDocumentSigningService service;
  private SifenActiveCertificateMaterial material;
  private SifenControlNumberFields cdcFields;
  private SifenInvoiceHeader header;
  private SifenInvoiceDetail detail;

  @BeforeEach
  void setUp() throws Exception {
    service =
        new SifenDocumentSigningService(
            certificateService,
            headerService,
            detailService,
            controlNumberService,
            xmlService,
            new FemmeTimeProperties());
    material = loadFixtureCertificateMaterial();

    cdcFields =
        new SifenControlNumberFields(
            1, "1137152", 8, 1, 2, 14528, 2, LocalDate.of(2026, 7, 28), 1, "587326098");
    String cdc = controlNumberService.build(cdcFields);

    SifenIssuerData issuer =
        new SifenIssuerData(
            "1137152",
            8,
            "Lucía Zymanscki de Onieva Vit S.A.",
            "Avda. España 123",
            SifenTaxpayerType.LEGAL_ENTITY,
            "96020",
            "Peluquería y otros tratamientos de belleza",
            "021555000",
            "facturacion@example.com",
            "11",
            "CENTRAL",
            "3432",
            "FERNANDO DE LA MORA");
    SifenReceiverData receiver =
        new SifenReceiverData(null, "4123456", "Cliente Demo", null, null, null);
    header =
        new SifenInvoiceHeader(
            cdc,
            LocalDateTime.of(2026, 7, 28, 15, 0, 0),
            "1137152",
            1,
            2,
            LocalDate.of(2025, 1, 1),
            LocalDate.of(2027, 12, 31),
            issuer,
            receiver,
            false);

    SifenInvoiceLine line =
        new SifenInvoiceLine(
            "SVC-1",
            "Corte de cabello",
            null,
            1,
            "77",
            BigDecimal.valueOf(100_000),
            BigDecimal.ZERO,
            BigDecimal.valueOf(100_000),
            SifenTaxAffectation.GRAVADO,
            BigDecimal.valueOf(100),
            BigDecimal.valueOf(10),
            BigDecimal.valueOf(90909.09),
            BigDecimal.valueOf(9090.91));
    SifenInvoiceTotals totals =
        new SifenInvoiceTotals(
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            BigDecimal.valueOf(100_000),
            BigDecimal.valueOf(100_000),
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            BigDecimal.valueOf(100_000),
            BigDecimal.ZERO,
            BigDecimal.valueOf(90909.09),
            BigDecimal.valueOf(90909.09),
            BigDecimal.ZERO,
            BigDecimal.valueOf(9090.91),
            BigDecimal.valueOf(9090.91));
    detail =
        new SifenInvoiceDetail(
            List.of(line),
            totals,
            1,
            List.of(new SifenPaymentDetail(1, BigDecimal.valueOf(100_000))));
  }

  /** AC-01/AC-05: a correctly signed document validates with no errors. */
  @Test
  void sign_producesASignatureThatValidates() {
    Document unsigned = xmlService.buildDocument(header, detail, cdcFields, LocalDateTime.now());

    SifenSignedDocument signed = service.sign(material, unsigned, LocalDateTime.now());

    assertThat(signed.controlNumber()).isEqualTo(header.controlNumber());
    assertThat(service.verify(signed.document())).isTrue();
  }

  /** AC-03: altering the signed document's content after signing invalidates the signature. */
  @Test
  void verify_detectsTamperingAfterSigning() {
    Document unsigned = xmlService.buildDocument(header, detail, cdcFields, LocalDateTime.now());
    SifenSignedDocument signed = service.sign(material, unsigned, LocalDateTime.now());
    assertThat(service.verify(signed.document())).isTrue();

    var totalNodes =
        signed.document().getElementsByTagNameNS(SifenDocumentXmlService.SIFEN_NS, "dTotGralOpe");
    totalNodes.item(0).setTextContent("1");

    assertThat(service.verify(signed.document())).isFalse();
  }

  /** AC-05: an unsigned document (no <Signature> at all) fails verification, not an exception. */
  @Test
  void verify_returnsFalseForUnsignedDocument() {
    Document unsigned = xmlService.buildDocument(header, detail, cdcFields, LocalDateTime.now());

    assertThat(service.verify(unsigned)).isFalse();
  }

  /**
   * AC-04: the signed XML uses RSA-SHA256 + enveloped/exclusive-C14N transforms — the algorithm
   * URIs the Manual Técnico's Schema XML 1 requires (XS06/XS13), not an obsolete algorithm like
   * SHA-1.
   */
  @Test
  void sign_usesTheManualsRequiredAlgorithms() {
    Document unsigned = xmlService.buildDocument(header, detail, cdcFields, LocalDateTime.now());
    SifenSignedDocument signed = service.sign(material, unsigned, LocalDateTime.now());

    String xml = SifenDocumentXmlService.serialize(signed.document());
    assertThat(xml).contains("http://www.w3.org/2001/04/xmldsig-more#rsa-sha256");
    assertThat(xml).contains("http://www.w3.org/2000/09/xmldsig#enveloped-signature");
    assertThat(xml).contains("http://www.w3.org/2001/10/xml-exc-c14n#");
    assertThat(xml).contains("http://www.w3.org/2001/04/xmlenc#sha256");
  }

  /**
   * Manual sección 7.6: KeyInfo must carry only the certificate — no X509SubjectName,
   * X509IssuerSerial, X509IssuerName, X509SKI, or KeyValue/RSAKeyValue.
   */
  @Test
  void sign_keyInfoOnlyContainsTheCertificate() {
    Document unsigned = xmlService.buildDocument(header, detail, cdcFields, LocalDateTime.now());
    SifenSignedDocument signed = service.sign(material, unsigned, LocalDateTime.now());

    String xml = SifenDocumentXmlService.serialize(signed.document());
    assertThat(xml).contains("X509Certificate");
    assertThat(xml)
        .doesNotContain("X509SubjectName")
        .doesNotContain("X509IssuerSerial")
        .doesNotContain("X509IssuerName")
        .doesNotContain("X509SKI")
        .doesNotContain("KeyValue");
  }

  /**
   * AC-02: if the tenant has no valid certificate, signing is refused before any document assembly
   * is attempted — headerService/detailService are never even called.
   */
  @Test
  void signInvoice_withoutAValidCertificate_neverBuildsOrSignsTheDocument() {
    when(certificateService.requireActiveCertificate(TENANT_ID))
        .thenThrow(
            new ResponseStatusException(
                org.springframework.http.HttpStatus.PRECONDITION_FAILED,
                "SIFEN_NO_VALID_CERTIFICATE"));

    assertThatThrownBy(() -> service.signInvoice(TENANT_ID, INVOICE_ID))
        .isInstanceOf(ResponseStatusException.class)
        .hasMessageContaining("SIFEN_NO_VALID_CERTIFICATE");

    verifyNoInteractions(headerService, detailService);
  }

  /** AC-06: signInvoice signs with the material HU-21 resolved for this exact tenant. */
  @Test
  void signInvoice_signsWithTheTenantsActiveCertificate() {
    when(certificateService.requireActiveCertificate(TENANT_ID)).thenReturn(material);
    when(headerService.buildHeader(TENANT_ID, INVOICE_ID)).thenReturn(header);
    when(detailService.buildDetail(TENANT_ID, INVOICE_ID)).thenReturn(detail);

    SifenSignedDocument signed = service.signInvoice(TENANT_ID, INVOICE_ID);

    assertThat(signed.controlNumber()).isEqualTo(header.controlNumber());
    assertThat(service.verify(signed.document())).isTrue();
    verify(certificateService).requireActiveCertificate(TENANT_ID);
  }

  private static SifenActiveCertificateMaterial loadFixtureCertificateMaterial() throws Exception {
    try (InputStream in =
        SifenDocumentSigningServiceTest.class
            .getClassLoader()
            .getResourceAsStream("sifen/test-cert.p12")) {
      KeyStore keyStore = KeyStore.getInstance("PKCS12");
      keyStore.load(in, FIXTURE_PASSWORD.toCharArray());
      Enumeration<String> aliases = keyStore.aliases();
      String alias = aliases.nextElement();
      PrivateKey privateKey = (PrivateKey) keyStore.getKey(alias, FIXTURE_PASSWORD.toCharArray());
      X509Certificate certificate = (X509Certificate) keyStore.getCertificate(alias);
      return new SifenActiveCertificateMaterial(
          1L, keyStore, FIXTURE_PASSWORD, alias, certificate, privateKey);
    }
  }
}
