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
            "12",
            "CENTRAL",
            "5044",
            "FERNANDO DE LA MORA");
    SifenReceiverData receiver =
        new SifenReceiverData(null, "4123456", "Cliente Demo", null, null, null, null, null);
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
    assertThat(xpath(doc, "//*[local-name()='cDepEmi']")).isEqualTo("12");
    assertThat(xpath(doc, "//*[local-name()='cCiuEmi']")).isEqualTo("5044");
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
    SifenReceiverData anonymous =
        new SifenReceiverData(null, null, null, null, null, null, null, null);
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

  /**
   * AC-07: si se informa la dirección del cliente (con sus códigos DNIT), el documento también
   * incluye su departamento y ciudad — D219/D220/D223/D224.
   */
  @Test
  void buildDocument_receiverWithAddressAndGeographicCodes_includesDepartmentAndCity()
      throws Exception {
    SifenReceiverData receiverWithAddress =
        new SifenReceiverData(
            null,
            "4123456",
            "Cliente Demo",
            "Avda. Mcal. López 456",
            "12",
            "CENTRAL",
            "5044",
            "FERNANDO DE LA MORA");
    SifenInvoiceHeader headerWithAddress =
        new SifenInvoiceHeader(
            header.controlNumber(),
            header.issueDateTime(),
            header.stampNumber(),
            header.establishment(),
            header.expeditionPoint(),
            header.stampValidFrom(),
            header.stampValidUntil(),
            header.issuer(),
            receiverWithAddress,
            header.testEnvironmentNotice());

    Document doc = service.buildDocument(headerWithAddress, detail, cdcFields, LocalDateTime.now());

    assertThat(xpath(doc, "//*[local-name()='dDirRec']")).isEqualTo("Avda. Mcal. López 456");
    assertThat(xpath(doc, "//*[local-name()='cDepRec']")).isEqualTo("12");
    assertThat(xpath(doc, "//*[local-name()='dDesDepRec']")).isEqualTo("CENTRAL");
    assertThat(xpath(doc, "//*[local-name()='cCiuRec']")).isEqualTo("5044");
    assertThat(xpath(doc, "//*[local-name()='dDesCiuRec']")).isEqualTo("FERNANDO DE LA MORA");
  }

  /** AC-07 (negative): an address without department/city codes on file emits neither field. */
  @Test
  void buildDocument_receiverWithAddressButNoGeographicCodes_omitsDepartmentAndCity()
      throws Exception {
    SifenReceiverData receiverWithAddress =
        new SifenReceiverData(
            null, "4123456", "Cliente Demo", "Avda. Mcal. López 456", null, null, null, null);
    SifenInvoiceHeader headerWithAddress =
        new SifenInvoiceHeader(
            header.controlNumber(),
            header.issueDateTime(),
            header.stampNumber(),
            header.establishment(),
            header.expeditionPoint(),
            header.stampValidFrom(),
            header.stampValidUntil(),
            header.issuer(),
            receiverWithAddress,
            header.testEnvironmentNotice());

    Document doc = service.buildDocument(headerWithAddress, detail, cdcFields, LocalDateTime.now());

    assertThat(xpath(doc, "//*[local-name()='dDirRec']")).isEqualTo("Avda. Mcal. López 456");
    assertThat(((NodeList) xpathNodes(doc, "//*[local-name()='cDepRec']")).getLength()).isZero();
    assertThat(((NodeList) xpathNodes(doc, "//*[local-name()='cCiuRec']")).getLength()).isZero();
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

  /**
   * SIFEN HU-13 bonus finding: the real production currency catalog (Monedas_v150.xsd's {@code
   * <CodeName>} for PYG) spells the currency description without an accent — "Guarani", not
   * "Guaraní" — confirmed live 2026-07-28 (dCodRes=1206 "Descripción de la moneda de la operación
   * no corresponde al código" disappeared once fixed). Both occurrences (D1's operation currency
   * and E7.1's payment currency) must use the unaccented spelling.
   */
  @Test
  void buildDocument_usesUnaccentedGuaraniForBothCurrencyDescriptions() throws Exception {
    Document doc = service.buildDocument(header, detail, cdcFields, LocalDateTime.now());

    assertThat(xpath(doc, "//*[local-name()='dDesMoneOpe']")).isEqualTo("Guarani");
    assertThat(xpath(doc, "//*[local-name()='dDMoneTiPag']")).isEqualTo("Guarani");
  }

  /**
   * SIFEN HU-13 gap fix: dFeFinT (C009) is commented out of the real production schema (DE_v150.xsd
   * downloaded live 2026-07-28) — never emit it, even though dFeIniT (C008) stays.
   */
  @Test
  void buildDocument_neverEmitsDFeFinT() throws Exception {
    Document doc = service.buildDocument(header, detail, cdcFields, LocalDateTime.now());

    NodeList feFinT = (NodeList) xpathNodes(doc, "//*[local-name()='dFeFinT']");
    assertThat(feFinT.getLength()).isZero();
    assertThat(xpath(doc, "//*[local-name()='dFeIniT']")).isEqualTo("2025-01-01");
  }

  /**
   * SIFEN HU-13 gap fix: dDesUniMed (E710) must be the schema's closed-enumeration abbreviation
   * ("UNI" for cUniMed=77/Unidad), not the free-text "Unidad" this used to send.
   */
  @Test
  void buildDocument_mapsUnitOfMeasureDescriptionAsUni() throws Exception {
    Document doc = service.buildDocument(header, detail, cdcFields, LocalDateTime.now());

    assertThat(xpath(doc, "//*[local-name()='cUniMed']")).isEqualTo("77");
    assertThat(xpath(doc, "//*[local-name()='dDesUniMed']")).isEqualTo("UNI");
  }

  /**
   * SIFEN HU-13 gap fix: dBasExe (E737) is a mandatory child of gCamIVA in the real production
   * schema — always present, "0" for every affectation except gravado parcial (iAfecIVA=4).
   */
  @Test
  void buildDocument_includesZeroExemptBase_whenLineIsNotGravadoParcial() throws Exception {
    Document doc = service.buildDocument(header, detail, cdcFields, LocalDateTime.now());

    assertThat(xpath(doc, "//*[local-name()='dBasExe']")).isEqualTo("0");
  }

  /**
   * SIFEN HU-13 gap fix, NT-013 formula: for a gravado-parcial line, dBasExe = [100 * dTotOpeItem *
   * (100 - dPropIVA)] / [10000 + (dTasaIVA * dPropIVA)]. This affectation isn't reachable through
   * any real invoice in this domain today (see SifenTaxAffectation javadoc) — exercised here only
   * to prove the formula itself is correct, in case it becomes reachable later.
   */
  @Test
  void buildDocument_computesExemptBase_forGravadoParcialLine() throws Exception {
    SifenInvoiceLine gravadoParcialLine =
        new SifenInvoiceLine(
            "SVC-2",
            "Servicio mixto",
            null,
            1,
            "77",
            BigDecimal.valueOf(100_000),
            BigDecimal.ZERO,
            BigDecimal.valueOf(100_000),
            SifenTaxAffectation.GRAVADO_PARCIAL,
            BigDecimal.valueOf(50),
            BigDecimal.valueOf(10),
            BigDecimal.valueOf(45454.55),
            BigDecimal.valueOf(4545.45));
    SifenInvoiceDetail detailWithGravadoParcialLine =
        new SifenInvoiceDetail(List.of(gravadoParcialLine), detail.totals(), 1, detail.payments());

    Document doc =
        service.buildDocument(header, detailWithGravadoParcialLine, cdcFields, LocalDateTime.now());

    assertThat(xpath(doc, "//*[local-name()='iAfecIVA']")).isEqualTo("4");
    assertThat(xpath(doc, "//*[local-name()='dDesAfecIVA']"))
        .isEqualTo("Gravado parcial (Grav- Exento)");
    assertThat(xpath(doc, "//*[local-name()='dBasExe']")).isEqualTo("47619.04761905");
  }

  // ---------------------------------------------------------------------------------------------
  // SIFEN HU-14: nota de crédito, nota de débito, autofactura, nota de remisión.
  // ---------------------------------------------------------------------------------------------

  private SifenControlNumberFields cdcFieldsForType(SifenDocumentType type) {
    return new SifenControlNumberFields(
        type.sifenCode(), "1137152", 8, 1, 2, 14528, 2, LocalDate.of(2026, 7, 28), 1, "587326098");
  }

  /**
   * AC-01: iTiDE/dDesTiDE reflect the real production catalog's literal for each of the 4 types.
   */
  @Test
  void buildDocument_notaCredito_usesCorrectDocumentTypeCodeAndDescription() throws Exception {
    SifenControlNumberFields ncCdcFields = cdcFieldsForType(SifenDocumentType.NOTA_CREDITO);
    Document doc =
        service.buildDocument(
            header,
            detail,
            ncCdcFields,
            LocalDateTime.now(),
            SifenDocumentTypeExtras.creditDebitNote(
                new SifenCreditDebitNoteData(3, "0".repeat(43) + "1")));

    assertThat(xpath(doc, "//*[local-name()='iTiDE']")).isEqualTo("5");
    assertThat(xpath(doc, "//*[local-name()='dDesTiDE']")).isEqualTo("Nota de crédito electrónica");
  }

  /** AC-02/AC-03: gCamNCDE (motivo) + gCamDEAsoc (referencia a la factura ya aprobada). */
  @Test
  void buildDocument_notaCredito_includesMotiveAndAssociatedInvoiceReference() throws Exception {
    String referencedCdc = "0".repeat(43) + "1";
    Document doc =
        service.buildDocument(
            header,
            detail,
            cdcFieldsForType(SifenDocumentType.NOTA_CREDITO),
            LocalDateTime.now(),
            SifenDocumentTypeExtras.creditDebitNote(
                new SifenCreditDebitNoteData(2, referencedCdc)));

    assertThat(xpath(doc, "//*[local-name()='iMotEmi']")).isEqualTo("2");
    assertThat(xpath(doc, "//*[local-name()='dDesMotEmi']")).isEqualTo("Devolución");
    assertThat(xpath(doc, "//*[local-name()='iTipDocAso']")).isEqualTo("1");
    assertThat(xpath(doc, "//*[local-name()='dDesTipDocAso']")).isEqualTo("Electrónico");
    assertThat(xpath(doc, "//*[local-name()='dCdCDERef']")).isEqualTo(referencedCdc);
  }

  /** AC-01/AC-03: nota de débito shares the exact same gCamNCDE/gCamDEAsoc shape, iTiDE=6. */
  @Test
  void buildDocument_notaDebito_usesCorrectDocumentTypeAndIncludesAssociatedInvoiceReference()
      throws Exception {
    String referencedCdc = "0".repeat(43) + "2";
    Document doc =
        service.buildDocument(
            header,
            detail,
            cdcFieldsForType(SifenDocumentType.NOTA_DEBITO),
            LocalDateTime.now(),
            SifenDocumentTypeExtras.creditDebitNote(
                new SifenCreditDebitNoteData(8, referencedCdc)));

    assertThat(xpath(doc, "//*[local-name()='iTiDE']")).isEqualTo("6");
    assertThat(xpath(doc, "//*[local-name()='dDesTiDE']")).isEqualTo("Nota de débito electrónica");
    assertThat(xpath(doc, "//*[local-name()='iMotEmi']")).isEqualTo("8");
    assertThat(xpath(doc, "//*[local-name()='dDesMotEmi']")).isEqualTo("Ajuste de precio");
    assertThat(xpath(doc, "//*[local-name()='dCdCDERef']")).isEqualTo(referencedCdc);
  }

  /** AC-01/AC-02: autofactura's gCamAE (proveedor no inscripto), iTiDE=4. */
  @Test
  void buildDocument_autofactura_includesProviderGroup() throws Exception {
    SifenAutoInvoiceProviderData provider =
        new SifenAutoInvoiceProviderData(
            1,
            1,
            "1234567",
            "Juan Proveedor",
            "Calle Falsa 123",
            "45",
            "12",
            "CENTRAL",
            "5044",
            "FERNANDO DE LA MORA");
    Document doc =
        service.buildDocument(
            header,
            detail,
            cdcFieldsForType(SifenDocumentType.AUTOFACTURA),
            LocalDateTime.now(),
            SifenDocumentTypeExtras.autoInvoiceProvider(provider));

    assertThat(xpath(doc, "//*[local-name()='iTiDE']")).isEqualTo("4");
    assertThat(xpath(doc, "//*[local-name()='dDesTiDE']")).isEqualTo("Autofactura electrónica");
    assertThat(xpath(doc, "//*[local-name()='iNatVen']")).isEqualTo("1");
    assertThat(xpath(doc, "//*[local-name()='dDesNatVen']")).isEqualTo("No contribuyente");
    assertThat(xpath(doc, "//*[local-name()='iTipIDVen']")).isEqualTo("1");
    assertThat(xpath(doc, "//*[local-name()='dDTipIDVen']")).isEqualTo("Cédula paraguaya");
    assertThat(xpath(doc, "//*[local-name()='dNumIDVen']")).isEqualTo("1234567");
    assertThat(xpath(doc, "//*[local-name()='dNomVen']")).isEqualTo("Juan Proveedor");
    assertThat(xpath(doc, "//*[local-name()='dDirProv']")).isEqualTo("Calle Falsa 123");
  }

  /** AC-01/AC-02: nota de remisión's gCamNRE (motivo) + gTransp (transporte), iTiDE=7. */
  @Test
  void buildDocument_notaRemision_includesMotiveAndTransportGroups() throws Exception {
    SifenGoodsRemissionData remission = new SifenGoodsRemissionData(1, 1, 25, 1, 1, null, 1);
    Document doc =
        service.buildDocument(
            header,
            detail,
            cdcFieldsForType(SifenDocumentType.NOTA_REMISION),
            LocalDateTime.now(),
            SifenDocumentTypeExtras.goodsRemission(remission));

    assertThat(xpath(doc, "//*[local-name()='iTiDE']")).isEqualTo("7");
    assertThat(xpath(doc, "//*[local-name()='dDesTiDE']"))
        .isEqualTo("Nota de remisión electrónica");
    assertThat(xpath(doc, "//*[local-name()='iMotEmiNR']")).isEqualTo("1");
    assertThat(xpath(doc, "//*[local-name()='dDesMotEmiNR']")).isEqualTo("Traslado por ventas");
    assertThat(xpath(doc, "//*[local-name()='iRespEmiNR']")).isEqualTo("1");
    assertThat(xpath(doc, "//*[local-name()='dKmR']")).isEqualTo("25");
    assertThat(xpath(doc, "//*[local-name()='iModTrans']")).isEqualTo("1");
    assertThat(xpath(doc, "//*[local-name()='dDesModTrans']")).isEqualTo("Terrestre");
    assertThat(xpath(doc, "//*[local-name()='iRespFlete']")).isEqualTo("1");
  }

  /**
   * SIFEN HU-14 scope decision: nota de remisión omits gCamCond (condición de pago) — a
   * goods-movement document has no payment concept, unlike every other type this class builds.
   */
  @Test
  void buildDocument_notaRemision_omitsPaymentConditionGroup() throws Exception {
    Document doc =
        service.buildDocument(
            header,
            detail,
            cdcFieldsForType(SifenDocumentType.NOTA_REMISION),
            LocalDateTime.now(),
            SifenDocumentTypeExtras.goodsRemission(
                new SifenGoodsRemissionData(1, 1, 25, 1, 1, null, 1)));

    NodeList gCamCond = (NodeList) xpathNodes(doc, "//*[local-name()='gCamCond']");
    assertThat(gCamCond.getLength()).isZero();
  }

  /**
   * SIFEN HU-14 gap fix: nota de crédito/débito must not emit gOpeCom's iTipTra/dDesTipTra —
   * confirmed live (2026-07-28), rejected with dCodRes=1216 "Tipo de transacción no requerido para
   * el tipo de documento electrónico seleccionado" — but the rest of gOpeCom (impuesto/moneda) is
   * still expected.
   */
  @Test
  void buildDocument_notaCredito_omitsTransactionTypeButKeepsRestOfOperationGroup()
      throws Exception {
    Document doc =
        service.buildDocument(
            header,
            detail,
            cdcFieldsForType(SifenDocumentType.NOTA_CREDITO),
            LocalDateTime.now(),
            SifenDocumentTypeExtras.creditDebitNote(
                new SifenCreditDebitNoteData(3, "0".repeat(43) + "1")));

    NodeList iTipTra = (NodeList) xpathNodes(doc, "//*[local-name()='iTipTra']");
    assertThat(iTipTra.getLength()).isZero();
    NodeList dDesTipTra = (NodeList) xpathNodes(doc, "//*[local-name()='dDesTipTra']");
    assertThat(dDesTipTra.getLength()).isZero();
    assertThat(xpath(doc, "//*[local-name()='iTImp']")).isEqualTo("1");
    assertThat(xpath(doc, "//*[local-name()='cMoneOpe']")).isEqualTo("PYG");
  }

  /**
   * SIFEN HU-14 gap fix: nota de remisión must not emit gOpeCom at all — confirmed live
   * (2026-07-28), rejected with dCodRes=1201 "Grupo de informaciones inherentes a la operación
   * comercial no es permitido para el tipo de documento".
   */
  @Test
  void buildDocument_notaRemision_omitsWholeOperationGroup() throws Exception {
    Document doc =
        service.buildDocument(
            header,
            detail,
            cdcFieldsForType(SifenDocumentType.NOTA_REMISION),
            LocalDateTime.now(),
            SifenDocumentTypeExtras.goodsRemission(
                new SifenGoodsRemissionData(1, 1, 25, 1, 1, null, 1)));

    NodeList gOpeCom = (NodeList) xpathNodes(doc, "//*[local-name()='gOpeCom']");
    assertThat(gOpeCom.getLength()).isZero();
  }

  /** A plain factura (no extras) never emits any of the 4 new types' groups. */
  @Test
  void buildDocument_factura_neverEmitsOtherDocumentTypeGroups() throws Exception {
    Document doc = service.buildDocument(header, detail, cdcFields, LocalDateTime.now());

    for (String tag : List.of("gCamAE", "gCamNCDE", "gCamNRE", "gTransp", "gCamDEAsoc")) {
      NodeList nodes = (NodeList) xpathNodes(doc, "//*[local-name()='" + tag + "']");
      assertThat(nodes.getLength()).as(tag + " must not be present on a factura").isZero();
    }
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
