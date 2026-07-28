package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.enums.SifenTaxAffectation;
import com.cursorpoc.backend.util.ParaguayRucValidator;
import java.io.StringWriter;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;
import javax.xml.transform.OutputKeys;
import javax.xml.transform.Transformer;
import javax.xml.transform.TransformerException;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import org.springframework.stereotype.Service;
import org.w3c.dom.Document;
import org.w3c.dom.Element;

/**
 * SIFEN HU-04: assembles the unsigned {@code <rDE>} XML document — {@link SifenInvoiceHeader}
 * (HU-02) + {@link SifenInvoiceDetail} (HU-03) mapped onto the real element names of the manual's
 * Schema XML 18 (DE_v150.xsd) — ready for {@link SifenDocumentSigningService} to sign.
 *
 * <p><b>Scope note:</b> this maps every field already available in the domain model (groups
 * AA/A/B/C/D1/D2/D2.1/D3/E1/E7/E7.1/E8/E8.1/E8.1.1/E8.2/F), using fixed domain-wide constants where
 * this business only has one possible value (moneda PYG, impuesto afectado IVA, tipo de transacción
 * "Prestación de servicios", indicador de presencia "Operación presencial"). It does <b>not</b>
 * attempt full DE_v150.xsd coverage — groups that don't apply to a cash-sale peluquería service
 * (D2.2 responsable, E7.1.1 tarjeta, E7.1.2 cheque, E7.2 crédito, E9.x sectores, E10 transporte, G,
 * H) are omitted, and the receiver's departamento/ciudad codes remain a known gap inherited from
 * HU-02 (department/city are free text there, not DNIT catalog codes). None of this blocks HU-04's
 * actual goal — signing whatever document this produces — closing full schema/homologación
 * compliance is EP-05's job (HU-12..HU-17).
 */
@Service
public class SifenDocumentXmlService {

  /** Schema XML 18 default namespace (Manual Técnico V150, sección 10.5). */
  static final String SIFEN_NS = "http://ekuatia.set.gov.py/sifen/xsd";

  private static final String XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";
  private static final DateTimeFormatter DATE_TIME_FORMAT =
      DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss");
  private static final DateTimeFormatter DATE_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd");

  /**
   * Builds the unsigned {@code <rDE>} document. {@code signatureTimestamp} becomes A004/dFecFirma —
   * the caller (the signing service) must pass the same instant it's about to sign with, since that
   * field is defined as "fecha de la firma", not "fecha de construcción del XML".
   */
  public Document buildDocument(
      SifenInvoiceHeader header,
      SifenInvoiceDetail detail,
      SifenControlNumberFields cdcFields,
      LocalDateTime signatureTimestamp) {
    Document doc = newDocument();

    Element rDE = doc.createElementNS(SIFEN_NS, "rDE");
    rDE.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns:xsi", XSI_NS);
    // Standard XSD convention: xsi:schemaLocation pairs a namespace URI with its schema document
    // URI, space-separated — NOT concatenated with a slash. The manual's own example (sección
    // 7.2.2.1) uses the slash-joined form, but the real SIFEN test server rejects that with
    // dCodRes=0160 "No se informó el schema en el XML" (verified live, 2026-07-28); the
    // space-separated pair (matching the manual's *other* example in sección 7.2.2) is what it
    // actually expects.
    rDE.setAttributeNS(XSI_NS, "xsi:schemaLocation", SIFEN_NS + " siRecepDE_v150.xsd");
    doc.appendChild(rDE);
    el(doc, rDE, "dVerFor", "150");

    Element de = el(doc, rDE, "DE", null);
    de.setAttribute("Id", header.controlNumber());
    de.setIdAttribute("Id", true);

    el(doc, de, "dDVId", header.controlNumber().substring(43));
    el(
        doc,
        de,
        "dFecFirma",
        signatureTimestamp.truncatedTo(ChronoUnit.SECONDS).format(DATE_TIME_FORMAT));
    el(doc, de, "dSisFact", "1");

    buildOperationGroup(doc, de, cdcFields);
    buildStampGroup(doc, de, header, cdcFields);
    buildGeneralDataGroup(doc, de, header, detail);
    buildItemsAndTotals(doc, de, detail);

    return doc;
  }

  /** B. Campos inherentes a la operación de Documentos Electrónicos. */
  private void buildOperationGroup(Document doc, Element de, SifenControlNumberFields cdcFields) {
    Element gOpeDE = el(doc, de, "gOpeDE", null);
    el(doc, gOpeDE, "iTipEmi", String.valueOf(cdcFields.emissionType()));
    el(doc, gOpeDE, "dDesTipEmi", cdcFields.emissionType() == 1 ? "Normal" : "Contingencia");
    el(doc, gOpeDE, "dCodSeg", cdcFields.securityCode());
  }

  /** C. Campos de datos del Timbrado. */
  private void buildStampGroup(
      Document doc, Element de, SifenInvoiceHeader header, SifenControlNumberFields cdcFields) {
    Element gTimb = el(doc, de, "gTimb", null);
    el(doc, gTimb, "iTiDE", String.valueOf(cdcFields.documentType()));
    el(doc, gTimb, "dDesTiDE", "Factura electrónica");
    el(doc, gTimb, "dNumTim", pad(header.stampNumber(), 8));
    el(doc, gTimb, "dEst", pad(header.establishment(), 3));
    el(doc, gTimb, "dPunExp", pad(header.expeditionPoint(), 3));
    el(doc, gTimb, "dNumDoc", pad(cdcFields.documentNumber(), 7));
    el(doc, gTimb, "dFeIniT", header.stampValidFrom().format(DATE_FORMAT));
    el(doc, gTimb, "dFeFinT", header.stampValidUntil().format(DATE_FORMAT));
  }

  /** D. Campos Generales del DE: D1 (operación comercial), D2 (emisor), D3 (receptor). */
  private void buildGeneralDataGroup(
      Document doc, Element de, SifenInvoiceHeader header, SifenInvoiceDetail detail) {
    Element gDatGralOpe = el(doc, de, "gDatGralOpe", null);
    el(doc, gDatGralOpe, "dFeEmiDE", header.issueDateTime().format(DATE_TIME_FORMAT));

    // D1: fixed to "Prestación de servicios" / IVA / PYG — the only values this business has.
    Element gOpeCom = el(doc, gDatGralOpe, "gOpeCom", null);
    el(doc, gOpeCom, "iTipTra", "2");
    el(doc, gOpeCom, "dDesTipTra", "Prestación de servicios");
    el(doc, gOpeCom, "iTImp", "1");
    el(doc, gOpeCom, "dDesTImp", "IVA");
    el(doc, gOpeCom, "cMoneOpe", "PYG");
    el(doc, gOpeCom, "dDesMoneOpe", "Guaraní");

    buildIssuer(doc, gDatGralOpe, header.issuer());
    buildReceiver(doc, gDatGralOpe, header.receiver());
  }

  /** D2/D2.1: emisor + su actividad económica. */
  private void buildIssuer(Document doc, Element gDatGralOpe, SifenIssuerData issuer) {
    Element gEmis = el(doc, gDatGralOpe, "gEmis", null);
    el(doc, gEmis, "dRucEm", issuer.ruc());
    el(doc, gEmis, "dDVEmi", String.valueOf(issuer.rucCheckDigit()));
    el(doc, gEmis, "iTipCont", String.valueOf(issuer.taxpayerType().sifenCode()));
    el(doc, gEmis, "dNomEmi", issuer.businessName());
    el(doc, gEmis, "dDirEmi", issuer.address());
    // D108/dNumCas: no separate house-number field in this domain's address — the manual itself
    // sanctions "0" when there's no numeration to report.
    el(doc, gEmis, "dNumCas", "0");
    el(doc, gEmis, "cDepEmi", issuer.departmentCode());
    el(doc, gEmis, "dDesDepEmi", issuer.departmentName());
    el(doc, gEmis, "cCiuEmi", issuer.cityCode());
    el(doc, gEmis, "dDesCiuEmi", issuer.cityName());
    el(doc, gEmis, "dTelEmi", issuer.phone());
    el(doc, gEmis, "dEmailE", issuer.contactEmail());

    Element gActEco = el(doc, gEmis, "gActEco", null);
    el(doc, gActEco, "cActEco", issuer.economicActivityCode());
    el(doc, gActEco, "dDesActEco", issuer.economicActivityDescription());
  }

  /**
   * D3: receptor. Known gap inherited from HU-02: {@code department}/{@code city} are free text on
   * {@code Client}, not DNIT catalog codes, so D219/D223 (cDepRec/cCiuRec) can't be populated even
   * when an address is present — only D213/dDirRec is emitted.
   *
   * <p>D205/iTiContRec (persona física vs jurídica of a receiver with RUC) has no source field on
   * {@code Client} either — defaults to "1" (persona física) when a RUC is present, a best-effort
   * assumption documented here rather than left unset, since the field is otherwise mandatory.
   */
  private void buildReceiver(Document doc, Element gDatGralOpe, SifenReceiverData receiver) {
    Element gDatRec = el(doc, gDatGralOpe, "gDatRec", null);
    boolean hasRuc = !isBlank(receiver.ruc());
    el(doc, gDatRec, "iNatRec", hasRuc ? "1" : "2");
    el(doc, gDatRec, "iTiOpe", hasRuc ? "1" : "2");
    el(doc, gDatRec, "cPaisRec", "PRY");
    el(doc, gDatRec, "dDesPaisRe", "Paraguay");

    if (hasRuc) {
      ParaguayRucValidator.RucParts rucParts = ParaguayRucValidator.split(receiver.ruc());
      el(doc, gDatRec, "iTiContRec", "1");
      el(doc, gDatRec, "dRucRec", rucParts.base());
      el(doc, gDatRec, "dDVRec", String.valueOf(rucParts.checkDigit()));
    } else if (!isBlank(receiver.identityDocumentNumber())) {
      el(doc, gDatRec, "iTipIDRec", "1");
      el(doc, gDatRec, "dNumIDRec", receiver.identityDocumentNumber());
    } else {
      el(doc, gDatRec, "iTipIDRec", "5");
      el(doc, gDatRec, "dNumIDRec", "0");
    }

    el(doc, gDatRec, "dNomRec", isBlank(receiver.name()) ? "Sin Nombre" : receiver.name());
    if (!isBlank(receiver.address())) {
      el(doc, gDatRec, "dDirRec", receiver.address());
    }
  }

  /** E8 (ítems) + F (subtotales/totales). */
  private void buildItemsAndTotals(Document doc, Element de, SifenInvoiceDetail detail) {
    Element gDtipDE = el(doc, de, "gDtipDE", null);

    Element gCamFE = el(doc, gDtipDE, "gCamFE", null);
    el(doc, gCamFE, "iIndPres", "1");
    el(doc, gCamFE, "dDesIndPres", "Operación presencial");

    Element gCamCond = el(doc, gDtipDE, "gCamCond", null);
    el(doc, gCamCond, "iCondOpe", String.valueOf(detail.paymentCondition()));
    el(doc, gCamCond, "dDCondOpe", detail.paymentCondition() == 1 ? "Contado" : "Crédito");
    for (SifenPaymentDetail payment : detail.payments()) {
      Element gPaConEIni = el(doc, gCamCond, "gPaConEIni", null);
      el(doc, gPaConEIni, "iTiPago", String.valueOf(payment.typeCode()));
      el(doc, gPaConEIni, "dDesTiPag", paymentTypeDescription(payment.typeCode()));
      el(doc, gPaConEIni, "dMonTiPag", payment.amount().toPlainString());
      el(doc, gPaConEIni, "cMoneTiPag", "PYG");
      el(doc, gPaConEIni, "dDMoneTiPag", "Guaraní");
    }

    for (SifenInvoiceLine line : detail.lines()) {
      buildItem(doc, gDtipDE, line);
    }

    buildTotals(doc, de, detail.totals());
  }

  private void buildItem(Document doc, Element gDtipDE, SifenInvoiceLine line) {
    Element gCamItem = el(doc, gDtipDE, "gCamItem", null);
    el(doc, gCamItem, "dCodInt", line.internalCode());
    el(doc, gCamItem, "dDesProSer", line.description());
    el(doc, gCamItem, "cUniMed", line.unitOfMeasureCode());
    el(doc, gCamItem, "dDesUniMed", "Unidad");
    el(doc, gCamItem, "dCantProSer", String.valueOf(line.quantity()));
    if (line.additionalInfo() != null) {
      el(doc, gCamItem, "dInfItem", line.additionalInfo());
    }

    Element gValorItem = el(doc, gCamItem, "gValorItem", null);
    el(doc, gValorItem, "dPUniProSer", line.unitPrice().toPlainString());
    BigDecimal totalBruto = line.unitPrice().multiply(BigDecimal.valueOf(line.quantity()));
    el(doc, gValorItem, "dTotBruOpeItem", totalBruto.toPlainString());

    // E8.1.1: HU-03 already folds the per-line discount and the prorated invoice-level global
    // discount into one combined SifenInvoiceLine.discountAmount (EA002) — so EA004 is always 0
    // here, it's not a second, separate discount.
    Element gValorRestaItem = el(doc, gValorItem, "gValorRestaItem", null);
    el(doc, gValorRestaItem, "dDescItem", line.discountAmount().toPlainString());
    el(doc, gValorRestaItem, "dDescGloItem", "0");
    el(doc, gValorRestaItem, "dTotOpeItem", line.netTotal().toPlainString());

    Element gCamIVA = el(doc, gCamItem, "gCamIVA", null);
    el(doc, gCamIVA, "iAfecIVA", String.valueOf(line.taxAffectation().sifenCode()));
    el(doc, gCamIVA, "dDesAfecIVA", taxAffectationDescription(line.taxAffectation()));
    el(doc, gCamIVA, "dPropIVA", line.taxProportion().toPlainString());
    el(doc, gCamIVA, "dTasaIVA", line.taxRatePercent().toPlainString());
    el(doc, gCamIVA, "dBasGravIVA", line.taxableBase().toPlainString());
    el(doc, gCamIVA, "dLiqIVAItem", line.taxAmount().toPlainString());
  }

  private void buildTotals(Document doc, Element de, SifenInvoiceTotals totals) {
    Element gTotSub = el(doc, de, "gTotSub", null);
    el(doc, gTotSub, "dSubExe", totals.exemptSubtotal().toPlainString());
    el(doc, gTotSub, "dSubExo", "0");
    el(doc, gTotSub, "dSub5", totals.taxedSubtotal5().toPlainString());
    el(doc, gTotSub, "dSub10", totals.taxedSubtotal10().toPlainString());
    el(doc, gTotSub, "dTotOpe", totals.grossTotal().toPlainString());
    el(doc, gTotSub, "dTotDesc", totals.perLineDiscountTotal().toPlainString());
    el(doc, gTotSub, "dTotDescGlotem", totals.globalDiscountTotal().toPlainString());
    el(doc, gTotSub, "dTotAntItem", "0");
    el(doc, gTotSub, "dTotAnt", "0");
    el(doc, gTotSub, "dPorcDescTotal", discountPercent(totals).toPlainString());
    el(doc, gTotSub, "dDescTotal", totals.totalDiscount().toPlainString());
    el(doc, gTotSub, "dAnticipo", "0");
    el(doc, gTotSub, "dRedon", "0");
    el(doc, gTotSub, "dTotGralOpe", totals.netTotal().toPlainString());
    el(doc, gTotSub, "dIVA5", totals.iva5().toPlainString());
    el(doc, gTotSub, "dIVA10", totals.iva10().toPlainString());
    el(doc, gTotSub, "dTotIVA", totals.totalIva().toPlainString());
    el(doc, gTotSub, "dBaseGrav5", totals.taxableBase5().toPlainString());
    el(doc, gTotSub, "dBaseGrav10", totals.taxableBase10().toPlainString());
    el(doc, gTotSub, "dTBasGraIVA", totals.totalTaxableBase().toPlainString());
  }

  private static BigDecimal discountPercent(SifenInvoiceTotals totals) {
    if (totals.grossTotal().signum() == 0) {
      return BigDecimal.ZERO;
    }
    return totals
        .totalDiscount()
        .multiply(BigDecimal.valueOf(100))
        .divide(totals.grossTotal(), 8, RoundingMode.HALF_UP);
  }

  private static String paymentTypeDescription(int code) {
    return switch (code) {
      case 1 -> "Efectivo";
      case 3 -> "Tarjeta de crédito";
      case 4 -> "Tarjeta de débito";
      case 5 -> "Transferencia";
      default -> "Otro";
    };
  }

  private static String taxAffectationDescription(SifenTaxAffectation affectation) {
    return switch (affectation) {
      case GRAVADO -> "Gravado IVA";
      case EXONERADO -> "Exonerado (Art. 83- Ley 125/91)";
      case EXENTO -> "Exento";
      case GRAVADO_PARCIAL -> "Gravado parcial (Grav-Exento)";
    };
  }

  private static boolean isBlank(String s) {
    return s == null || s.isBlank();
  }

  private static String pad(String raw, int length) {
    if (raw.length() >= length) {
      return raw;
    }
    return "0".repeat(length - raw.length()) + raw;
  }

  private static String pad(long value, int length) {
    return pad(Long.toString(value), length);
  }

  private static Element el(Document doc, Element parent, String localName, String text) {
    Element element = doc.createElementNS(SIFEN_NS, localName);
    if (text != null) {
      element.setTextContent(text);
    }
    parent.appendChild(element);
    return element;
  }

  private static Document newDocument() {
    try {
      DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
      factory.setNamespaceAware(true);
      DocumentBuilder builder = factory.newDocumentBuilder();
      return builder.newDocument();
    } catch (ParserConfigurationException e) {
      throw new IllegalStateException("Failed to create a new XML document", e);
    }
  }

  /** Serializes a DOM document to a UTF-8 XML string — used to persist/inspect a signed DE. */
  public static String serialize(Document doc) {
    try {
      Transformer transformer = TransformerFactory.newInstance().newTransformer();
      transformer.setOutputProperty(OutputKeys.OMIT_XML_DECLARATION, "yes");
      StringWriter writer = new StringWriter();
      transformer.transform(new DOMSource(doc), new StreamResult(writer));
      return writer.toString();
    } catch (TransformerException e) {
      throw new IllegalStateException("Failed to serialize XML document", e);
    }
  }
}
