package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.domain.enums.SifenTaxAffectation;
import com.cursorpoc.backend.domain.enums.SifenTaxpayerType;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import javax.xml.xpath.XPath;
import javax.xml.xpath.XPathConstants;
import javax.xml.xpath.XPathFactory;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.w3c.dom.Document;
import org.w3c.dom.NodeList;

class SifenDocumentXmlServiceTest {

  private final SifenDocumentXmlService service = new SifenDocumentXmlService();
  private final SifenControlNumberService controlNumberService = new SifenControlNumberService();

  private SifenControlNumberFields cdcFields;
  private String cdc;
  private SifenInvoiceHeader header;
  private SifenInvoiceDetail detail;

  @BeforeEach
  void setUp() {
    cdcFields =
        new SifenControlNumberFields(
            1, "1137152", 8, 1, 2, 14528, 2, LocalDate.of(2026, 7, 28), 1, "587326098");
    cdc = controlNumberService.build(cdcFields);

    SifenIssuerData issuer =
        new SifenIssuerData(
            "1137152",
            8,
            "Lucía Zymanscki de Onieva Vit S.A.",
            "Nombre de Fantasía Demo",
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

  /** AC-01: the built document has a single, real <DE Id="cdc"> element covering the invoice. */
  @Test
  void buildDocument_producesDeElementWithControlNumberAsId() throws Exception {
    Document doc = service.buildDocument(header, detail, cdcFields, LocalDateTime.now());

    assertThat(xpath(doc, "local-name(/*)")).isEqualTo("rDE");
    assertThat(xpath(doc, "//*[local-name()='dVerFor']")).isEqualTo("150");
    assertThat(xpath(doc, "//*[local-name()='DE']/@Id")).isEqualTo(cdc);
    assertThat(xpath(doc, "//*[local-name()='dDVId']")).isEqualTo(cdc.substring(43));
  }

  @Test
  void buildDocument_mapsIssuerFields() throws Exception {
    Document doc = service.buildDocument(header, detail, cdcFields, LocalDateTime.now());

    assertThat(xpath(doc, "//*[local-name()='dRucEm']")).isEqualTo("1137152");
    assertThat(xpath(doc, "//*[local-name()='dDVEmi']")).isEqualTo("8");
    assertThat(xpath(doc, "//*[local-name()='dNomEmi']"))
        .isEqualTo("Lucía Zymanscki de Onieva Vit S.A.");
    // SIFEN HU-08 AC-03: D106/dNomFanEmi is optional (0-1) but emitted when configured.
    assertThat(xpath(doc, "//*[local-name()='dNomFanEmi']")).isEqualTo("Nombre de Fantasía Demo");
    assertThat(xpath(doc, "//*[local-name()='cDepEmi']")).isEqualTo("11");
    assertThat(xpath(doc, "//*[local-name()='cCiuEmi']")).isEqualTo("3432");
    assertThat(xpath(doc, "//*[local-name()='dTelEmi']")).isEqualTo("021555000");
    assertThat(xpath(doc, "//*[local-name()='cActEco']")).isEqualTo("96020");
  }

  /**
   * SIFEN HU-08 AC-03: dNomFanEmi is 0-1 in the schema — omitted, not emitted blank, when unset.
   */
  @Test
  void buildDocument_omitsFantasyNameWhenNotConfigured() throws Exception {
    SifenIssuerData issuerWithoutFantasyName =
        new SifenIssuerData(
            header.issuer().ruc(),
            header.issuer().rucCheckDigit(),
            header.issuer().businessName(),
            null,
            header.issuer().address(),
            header.issuer().taxpayerType(),
            header.issuer().economicActivityCode(),
            header.issuer().economicActivityDescription(),
            header.issuer().phone(),
            header.issuer().contactEmail(),
            header.issuer().departmentCode(),
            header.issuer().departmentName(),
            header.issuer().cityCode(),
            header.issuer().cityName());
    SifenInvoiceHeader headerWithoutFantasyName =
        new SifenInvoiceHeader(
            header.controlNumber(),
            header.issueDateTime(),
            header.stampNumber(),
            header.establishment(),
            header.expeditionPoint(),
            header.stampValidFrom(),
            header.stampValidUntil(),
            issuerWithoutFantasyName,
            header.receiver(),
            header.testEnvironmentNotice());

    Document doc =
        service.buildDocument(headerWithoutFantasyName, detail, cdcFields, LocalDateTime.now());

    assertThat(xpath(doc, "//*[local-name()='dNomFanEmi']")).isEmpty();
  }

  /** AC-08 (HU-02): the test-environment legend flows straight through into dNomEmi. */
  @Test
  void buildDocument_testEnvironmentLegend_isUsedAsIssuerName() throws Exception {
    SifenIssuerData legendIssuer =
        new SifenIssuerData(
            header.issuer().ruc(),
            header.issuer().rucCheckDigit(),
            SifenInvoiceHeaderService.TEST_ENVIRONMENT_ISSUER_NAME_LEGEND,
            header.issuer().fantasyName(),
            header.issuer().address(),
            header.issuer().taxpayerType(),
            header.issuer().economicActivityCode(),
            header.issuer().economicActivityDescription(),
            header.issuer().phone(),
            header.issuer().contactEmail(),
            header.issuer().departmentCode(),
            header.issuer().departmentName(),
            header.issuer().cityCode(),
            header.issuer().cityName());
    SifenInvoiceHeader testHeader =
        new SifenInvoiceHeader(
            header.controlNumber(),
            header.issueDateTime(),
            header.stampNumber(),
            header.establishment(),
            header.expeditionPoint(),
            header.stampValidFrom(),
            header.stampValidUntil(),
            legendIssuer,
            header.receiver(),
            true);

    Document doc = service.buildDocument(testHeader, detail, cdcFields, LocalDateTime.now());

    assertThat(xpath(doc, "//*[local-name()='dNomEmi']"))
        .isEqualTo(SifenInvoiceHeaderService.TEST_ENVIRONMENT_ISSUER_NAME_LEGEND);
  }

  @Test
  void buildDocument_receiverWithoutRuc_usesIdentityDocument() throws Exception {
    Document doc = service.buildDocument(header, detail, cdcFields, LocalDateTime.now());

    assertThat(xpath(doc, "//*[local-name()='iNatRec']")).isEqualTo("2");
    assertThat(xpath(doc, "//*[local-name()='iTipIDRec']")).isEqualTo("1");
    assertThat(xpath(doc, "//*[local-name()='dNumIDRec']")).isEqualTo("4123456");
    assertThat(xpath(doc, "//*[local-name()='dNomRec']")).isEqualTo("Cliente Demo");
  }

  @Test
  void buildDocument_anonymousReceiver_usesInnominado() throws Exception {
    SifenReceiverData anonymous = new SifenReceiverData(null, null, null, null, null, null);
    SifenInvoiceHeader anonymousHeader =
        new SifenInvoiceHeader(
            header.controlNumber(),
            header.issueDateTime(),
            header.stampNumber(),
            header.establishment(),
            header.expeditionPoint(),
            header.stampValidFrom(),
            header.stampValidUntil(),
            header.issuer(),
            anonymous,
            header.testEnvironmentNotice());

    Document doc = service.buildDocument(anonymousHeader, detail, cdcFields, LocalDateTime.now());

    assertThat(xpath(doc, "//*[local-name()='iTipIDRec']")).isEqualTo("5");
    assertThat(xpath(doc, "//*[local-name()='dNumIDRec']")).isEqualTo("0");
    assertThat(xpath(doc, "//*[local-name()='dNomRec']")).isEqualTo("Sin Nombre");
  }

  /** AC-01 (HU-03): one <gCamItem> per billed service. */
  @Test
  void buildDocument_mapsOneItemPerLine() throws Exception {
    Document doc = service.buildDocument(header, detail, cdcFields, LocalDateTime.now());

    NodeList items = (NodeList) xpathNodes(doc, "//*[local-name()='gCamItem']");
    assertThat(items.getLength()).isEqualTo(1);
    assertThat(xpath(doc, "//*[local-name()='dDesProSer']")).isEqualTo("Corte de cabello");
    assertThat(xpath(doc, "//*[local-name()='dTasaIVA']")).isEqualTo("10");
    assertThat(xpath(doc, "//*[local-name()='dTotGralOpe']")).isEqualTo("100000");
  }

  @Test
  void buildDocument_mapsOnePaymentPerAllocation() throws Exception {
    Document doc = service.buildDocument(header, detail, cdcFields, LocalDateTime.now());

    assertThat(xpath(doc, "//*[local-name()='iTiPago']")).isEqualTo("1");
    assertThat(xpath(doc, "//*[local-name()='dDesTiPag']")).isEqualTo("Efectivo");
    assertThat(xpath(doc, "//*[local-name()='dMonTiPag']")).isEqualTo("100000");
  }

  private static String xpath(Document doc, String expression) throws Exception {
    XPath xPath = XPathFactory.newInstance().newXPath();
    return xPath.evaluate(expression, doc);
  }

  private static Object xpathNodes(Document doc, String expression) throws Exception {
    XPath xPath = XPathFactory.newInstance().newXPath();
    return xPath.evaluate(expression, doc, XPathConstants.NODESET);
  }
}
