package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.enums.ClientIdentityDocumentType;
import com.cursorpoc.backend.domain.enums.SifenTaxAffectation;
import com.cursorpoc.backend.util.ParaguayRucValidator;
import java.io.StringWriter;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
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
 * (D2.2 responsable, E7.1.1 tarjeta, E7.1.2 cheque, E7.2 crédito, E9.x sectores, G, H) are omitted,
 * and the receiver's departamento/ciudad codes remain a known gap inherited from HU-02 (department/
 * city are free text there, not DNIT catalog codes). None of this blocks HU-04's actual goal —
 * signing whatever document this produces — closing full schema/homologación compliance is EP-05's
 * job (HU-12..HU-17).
 *
 * <p><b>SIFEN HU-14</b> extends this beyond factura electrónica (C002/iTiDE=1): {@link
 * #buildDocument(SifenInvoiceHeader, SifenInvoiceDetail, SifenControlNumberFields, LocalDateTime,
 * SifenDocumentTypeExtras)} threads a {@link SifenDocumentTypeExtras} through to add nota de
 * crédito/débito's {@code gCamNCDE}+{@code gCamDEAsoc} (iTiDE 5/6), autofactura's {@code gCamAE}
 * (iTiDE 4), and nota de remisión's {@code gCamNRE}+{@code gTransp} (iTiDE 7, E10 transporte — the
 * one group this class's original scope note above explicitly deferred). Everything else (header/
 * emisor/receptor/ítems/totales/firma/QR) is shared unchanged across all 5 types this class builds.
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
    return buildDocument(
        header, detail, cdcFields, signatureTimestamp, SifenDocumentTypeExtras.NONE);
  }

  /**
   * SIFEN HU-14: same as {@link #buildDocument(SifenInvoiceHeader, SifenInvoiceDetail,
   * SifenControlNumberFields, LocalDateTime)}, extended to branch by document type (nota de
   * crédito/débito, autofactura, nota de remisión) via {@code extras} — reuses every group the base
   * factura path already builds (header/emisor/receptor/ítems/totales/firma/QR unchanged) and adds
   * only the type-specific groups {@code extras} carries, in the exact sequence order the real
   * schema ({@code DE_v150.xsd}) requires.
   */
  public Document buildDocument(
      SifenInvoiceHeader header,
      SifenInvoiceDetail detail,
      SifenControlNumberFields cdcFields,
      LocalDateTime signatureTimestamp,
      SifenDocumentTypeExtras extras) {
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

    SifenDocumentType documentType = SifenDocumentType.fromCode(cdcFields.documentType());
    buildOperationGroup(doc, de, cdcFields);
    buildStampGroup(doc, de, header, cdcFields);
    buildGeneralDataGroup(doc, de, header, detail, documentType);
    buildItemsAndTotals(
        doc, de, detail, extras, header.issueDateTime().toLocalDate(), header.issuer());
    buildAssociatedDocumentGroup(doc, de, extras, header);

    return doc;
  }

  /** B. Campos inherentes a la operación de Documentos Electrónicos. */
  private void buildOperationGroup(Document doc, Element de, SifenControlNumberFields cdcFields) {
    Element gOpeDE = el(doc, de, "gOpeDE", null);
    el(doc, gOpeDE, "iTipEmi", String.valueOf(cdcFields.emissionType()));
    el(doc, gOpeDE, "dDesTipEmi", cdcFields.emissionType() == 1 ? "Normal" : "Contingencia");
    el(doc, gOpeDE, "dCodSeg", cdcFields.securityCode());
  }

  /**
   * C. Campos de datos del Timbrado.
   *
   * <p><b>SIFEN HU-13 gap fix:</b> {@code dFeFinT} (C009) is <b>not</b> emitted — confirmed against
   * the real production schema ({@code DE_v150.xsd}, downloaded directly from {@code
   * https://ekuatia.set.gov.py/sifen/xsd/DE_v150.xsd}, 2026-07-28): the element is commented out
   * inside {@code gTimb}'s sequence (only {@code dSerieNum}/{@code dFeIniT} remain), the field
   * having been eliminated in v150 in favor of the two-letter series mechanism (AA, AB, ... ZZ) for
   * numbering continuity. The Manual Técnico V150 (sección "Tabla de formato de campos", tabla C)
   * still documents it as 1-1 obligatorio — a manual/schema divergence, same pattern as the
   * `dDesAfecIVA`/`dBasExe` gaps below. Sending it produced the live rejection this system had
   * documented since HU-06/HU-08 (schema doesn't expect this element at all). {@code
   * header.stampValidUntil()} is kept on the domain model and still used by the KuDE PDF (a locally
   * rendered receipt, not SIFEN-schema-validated) — only the DE XML stops emitting it.
   */
  private void buildStampGroup(
      Document doc, Element de, SifenInvoiceHeader header, SifenControlNumberFields cdcFields) {
    Element gTimb = el(doc, de, "gTimb", null);
    el(doc, gTimb, "iTiDE", String.valueOf(cdcFields.documentType()));
    // SIFEN HU-14: dDesTiDE now varies by document type — previously hardcoded to "Factura
    // electrónica" because HU-04..HU-13 only ever built that one type.
    el(doc, gTimb, "dDesTiDE", SifenDocumentType.fromCode(cdcFields.documentType()).description());
    el(doc, gTimb, "dNumTim", pad(header.stampNumber(), 8));
    el(doc, gTimb, "dEst", pad(header.establishment(), 3));
    el(doc, gTimb, "dPunExp", pad(header.expeditionPoint(), 3));
    el(doc, gTimb, "dNumDoc", pad(cdcFields.documentNumber(), 7));
    el(doc, gTimb, "dFeIniT", header.stampValidFrom().format(DATE_FORMAT));
  }

  /**
   * D. Campos Generales del DE: D1 (operación comercial), D2 (emisor), D3 (receptor).
   *
   * <p><b>SIFEN HU-14 gap fix — gOpeCom (D1) isn't valid for every document type, confirmed live
   * (2026-07-28), not from the manual/XSD alone</b> (both mark the whole group and every one of its
   * children {@code minOccurs="0"}, so nothing on paper ruled this out in advance): sending it
   * unconditionally on a nota de remisión was rejected with {@code dCodRes=1201 "Grupo de
   * informaciones inherentes a la operación comercial no es permitido para el tipo de documento"} —
   * a goods-movement document has no commercial-operation/currency/tax concept, so the entire group
   * is omitted for {@link SifenDocumentType#NOTA_REMISION}. Sending {@code iTipTra} on a nota de
   * crédito/débito was rejected with {@code dCodRes=1216 "Tipo de transacción no requerido para el
   * tipo de documento electrónico seleccionado"} — the rest of the group (impuesto/moneda) was
   * accepted, only {@code iTipTra}/{@code dDesTipTra} is disallowed for {@link
   * SifenDocumentType#NOTA_CREDITO}/{@link SifenDocumentType#NOTA_DEBITO} — a note adjusts an
   * already-issued invoice that already carries its own tipo de transacción, so repeating it on the
   * note itself is redundant. {@link SifenDocumentType#FACTURA}/{@link
   * SifenDocumentType#AUTOFACTURA} keep the full group unchanged (confirmed live: autofactura's
   * "correct" scenarios reach the same {@code 1252} RUC-inactive wall as factura, never {@code
   * 1201}/{@code 1216} — i.e. no schema/content complaint about this group for those 2 types).
   */
  private void buildGeneralDataGroup(
      Document doc,
      Element de,
      SifenInvoiceHeader header,
      SifenInvoiceDetail detail,
      SifenDocumentType documentType) {
    Element gDatGralOpe = el(doc, de, "gDatGralOpe", null);
    el(doc, gDatGralOpe, "dFeEmiDE", header.issueDateTime().format(DATE_TIME_FORMAT));

    if (documentType != SifenDocumentType.NOTA_REMISION) {
      Element gOpeCom = el(doc, gDatGralOpe, "gOpeCom", null);
      if (documentType != SifenDocumentType.NOTA_CREDITO
          && documentType != SifenDocumentType.NOTA_DEBITO) {
        // D1: fixed to "Prestación de servicios" — the only value this business has.
        el(doc, gOpeCom, "iTipTra", "2");
        el(doc, gOpeCom, "dDesTipTra", "Prestación de servicios");
      }
      el(doc, gOpeCom, "iTImp", "1");
      el(doc, gOpeCom, "dDesTImp", "IVA");
      el(doc, gOpeCom, "cMoneOpe", "PYG");
      // SIFEN HU-13 bonus finding: the real production catalog (Monedas_v150.xsd, cMondT
      // enumeration's <CodeName> for "PYG") documents the currency name as "Guarani" — no accent —
      // confirmed live (2026-07-28): sending "Guaraní" was rejected with dCodRes=1206 "Descripción
      // de la moneda de la operación no corresponde al código", a business-rule cross-check against
      // that exact catalog string, independent of the 3 schema gaps that history was chartered to
      // close.
      el(doc, gOpeCom, "dDesMoneOpe", "Guarani");
    }

    buildIssuer(doc, gDatGralOpe, header.issuer());
    buildReceiver(doc, gDatGralOpe, header.receiver(), documentType);
  }

  /** D2/D2.1: emisor + su actividad económica. */
  private void buildIssuer(Document doc, Element gDatGralOpe, SifenIssuerData issuer) {
    Element gEmis = el(doc, gDatGralOpe, "gEmis", null);
    el(doc, gEmis, "dRucEm", issuer.ruc());
    el(doc, gEmis, "dDVEmi", String.valueOf(issuer.rucCheckDigit()));
    el(doc, gEmis, "iTipCont", String.valueOf(issuer.taxpayerType().sifenCode()));
    el(doc, gEmis, "dNomEmi", issuer.businessName());
    if (!isBlank(issuer.fantasyName())) {
      el(doc, gEmis, "dNomFanEmi", issuer.fantasyName());
    }
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
   * D3: receptor. {@code documentType} affects two SIFEN-HU-14-era rules confirmed live: (a)
   * Autofactura (C002=4) requires {@code iTiOpe=2} (B2C) unconditionally (D202a/1316), regardless
   * of whether the "receiver" (the issuer self-billing) has a RUC; (b) Nota de Remisión (C002=7)
   * requires the receiver's address, and once an address is present {@code dNumCasRec} becomes
   * mandatory too (D213/1318) — defaulted to "0" since this domain has no distinct house-number
   * field on the receiver side.
   */
  private void buildReceiver(
      Document doc,
      Element gDatGralOpe,
      SifenReceiverData receiver,
      SifenDocumentType documentType) {
    Element gDatRec = el(doc, gDatGralOpe, "gDatRec", null);
    ClientIdentityDocumentType type =
        ClientIdentityDocumentType.resolve(
            receiver.identityDocumentType(), receiver.ruc(), receiver.identityDocumentNumber());
    boolean hasRuc = type == ClientIdentityDocumentType.RUC;
    boolean isAutoInvoice = documentType == SifenDocumentType.AUTOFACTURA;
    el(doc, gDatRec, "iNatRec", hasRuc ? "1" : "2");
    el(doc, gDatRec, "iTiOpe", isAutoInvoice ? "2" : hasRuc ? "1" : "2");
    el(doc, gDatRec, "cPaisRec", "PRY");
    el(doc, gDatRec, "dDesPaisRe", "Paraguay");

    if (hasRuc) {
      ParaguayRucValidator.RucParts rucParts = ParaguayRucValidator.split(receiver.ruc());
      el(doc, gDatRec, "iTiContRec", "1");
      el(doc, gDatRec, "dRucRec", rucParts.base());
      el(doc, gDatRec, "dDVRec", String.valueOf(rucParts.checkDigit()));
    } else if (type != ClientIdentityDocumentType.INNOMINADO
        && !isBlank(receiver.identityDocumentNumber())) {
      el(doc, gDatRec, "iTipIDRec", String.valueOf(type.sifenCode()));
      el(doc, gDatRec, "dDTipIDRec", type.description());
      el(doc, gDatRec, "dNumIDRec", receiver.identityDocumentNumber());
    } else {
      el(
          doc,
          gDatRec,
          "iTipIDRec",
          String.valueOf(ClientIdentityDocumentType.INNOMINADO.sifenCode()));
      el(doc, gDatRec, "dDTipIDRec", ClientIdentityDocumentType.INNOMINADO.description());
      el(doc, gDatRec, "dNumIDRec", "0");
    }

    el(doc, gDatRec, "dNomRec", isBlank(receiver.name()) ? "Sin Nombre" : receiver.name());
    if (!isBlank(receiver.address())) {
      el(doc, gDatRec, "dDirRec", receiver.address());
      el(doc, gDatRec, "dNumCasRec", "0");
      // SIFEN HU-02 AC-07: D219/D220 (cDepRec/dDesDepRec) and D223/D224 (cCiuRec/dDesCiuRec) —
      // "obligatorio si se informa D213 [dDirRec] y D202 [iTiOpe] != 4" (B2F/exterior, a value
      // this domain never sets — see iTiOpe above, always "1" or "2"). Only emitted when the
      // client actually has DNIT catalog codes on file (not every client with an address does).
      if (!isBlank(receiver.departmentCode())) {
        el(doc, gDatRec, "cDepRec", receiver.departmentCode());
        el(doc, gDatRec, "dDesDepRec", receiver.departmentName());
      }
      if (!isBlank(receiver.cityCode())) {
        el(doc, gDatRec, "cCiuRec", receiver.cityCode());
        el(doc, gDatRec, "dDesCiuRec", receiver.cityName());
      }
    }
  }

  /**
   * J. Campos fuera de la Firma Digital (SIFEN HU-08): agrega {@code gCamFuFD/dCarQR} como
   * <b>hermano</b> de {@code <DE>} y {@code <Signature>} dentro de {@code <rDE>} — no anidado
   * dentro de {@code <DE>}, porque el error real observado en vivo por HU-06 ("Elemento esperado:
   * gCamFuFD dentro de: rDE") confirma ese nivel. Debe llamarse <b>después</b> de firmar: el propio
   * valor de {@code qrUrl} depende del {@code DigestValue} que produce la firma (Manual Técnico
   * V150 sección 13.8.2, campo XS17) — agregarlo después no invalida la firma porque la referencia
   * firmada solo cubre {@code <DE>} (transforms enveloped + C14N exclusive sobre {@code
   * URI="#cdc"}), nunca sus hermanos.
   */
  public void appendQrGroup(Document rDe, String qrUrl) {
    Element root = rDe.getDocumentElement();
    Element gCamFuFD = el(rDe, root, "gCamFuFD", null);
    el(rDe, gCamFuFD, "dCarQR", qrUrl);
  }

  /**
   * E8 (ítems) + F (subtotales/totales). SIFEN HU-14: also threads {@code extras} through in the
   * exact sequence order {@code tgDtipDE} requires ({@code DE_v150.xsd}): {@code gCamFE} → {@code
   * gCamAE} → {@code gCamNCDE} → {@code gCamNRE} → {@code gCamCond} → {@code gCamItem}* → {@code
   * gTransp}.
   */
  private void buildItemsAndTotals(
      Document doc,
      Element de,
      SifenInvoiceDetail detail,
      SifenDocumentTypeExtras extras,
      LocalDate issueDate,
      SifenIssuerData issuer) {
    Element gDtipDE = el(doc, de, "gDtipDE", null);

    // SIFEN HU-14 gap found live (dCodRes=1351): gCamFE (E010, "Campos que componen la Factura
    // Electrónica FE") is exclusive to Factura (iTiDE=1) — forbidden for every other document
    // type, not just optional.
    boolean isFactura =
        extras.autoInvoiceProvider() == null
            && extras.creditDebitNote() == null
            && extras.goodsRemission() == null;
    if (isFactura) {
      Element gCamFE = el(doc, gDtipDE, "gCamFE", null);
      el(doc, gCamFE, "iIndPres", "1");
      el(doc, gCamFE, "dDesIndPres", "Operación presencial");
    }

    if (extras.autoInvoiceProvider() != null) {
      buildAutoInvoiceProviderGroup(doc, gDtipDE, extras.autoInvoiceProvider());
    }
    if (extras.creditDebitNote() != null) {
      buildCreditDebitNoteMotiveGroup(doc, gDtipDE, extras.creditDebitNote());
    }
    if (extras.goodsRemission() != null) {
      buildGoodsRemissionMotiveGroup(doc, gDtipDE, extras.goodsRemission());
    }

    // SIFEN HU-14 gap found live (dCodRes=1501): gCamCond (condición de la operación, E600) is
    // exclusive to Factura/Autofactura (C002=1 o 4) — forbidden for NC/ND and nota de remisión
    // alike, not merely optional for the latter as originally assumed.
    if (extras.goodsRemission() == null && extras.creditDebitNote() == null) {
      Element gCamCond = el(doc, gDtipDE, "gCamCond", null);
      el(doc, gCamCond, "iCondOpe", String.valueOf(detail.paymentCondition()));
      el(doc, gCamCond, "dDCondOpe", detail.paymentCondition() == 1 ? "Contado" : "Crédito");
      for (SifenPaymentDetail payment : detail.payments()) {
        Element gPaConEIni = el(doc, gCamCond, "gPaConEIni", null);
        el(doc, gPaConEIni, "iTiPago", String.valueOf(payment.typeCode()));
        el(doc, gPaConEIni, "dDesTiPag", paymentTypeDescription(payment.typeCode()));
        el(doc, gPaConEIni, "dMonTiPag", payment.amount().toPlainString());
        el(doc, gPaConEIni, "cMoneTiPag", "PYG");
        // Same fix as dDesMoneOpe above — same catalog, same field-content cross-check.
        el(doc, gPaConEIni, "dDMoneTiPag", "Guarani");
      }
    }

    for (SifenInvoiceLine line : detail.lines()) {
      buildItem(doc, gDtipDE, line, extras);
    }

    if (extras.goodsRemission() != null) {
      buildTransportGroup(doc, gDtipDE, extras.goodsRemission(), issueDate, issuer);
    }

    // SIFEN HU-14 gap found live (dCodRes=2351): gTotSub (F001, subtotales/totales) is forbidden
    // for nota de remisión — a goods-movement document has no monetary transaction to total at
    // all, consistent with the item-level omissions (gValorItem/gCamIVA) above and gOpeCom/
    // gCamCond already omitted in buildGeneralDataGroup/here.
    if (extras.goodsRemission() == null) {
      buildTotals(doc, de, detail.totals(), extras.autoInvoiceProvider() != null);
    }
  }

  /** gCamAE — SIFEN HU-14, autofactura: datos del proveedor no inscripto/extranjero. */
  private void buildAutoInvoiceProviderGroup(
      Document doc, Element gDtipDE, SifenAutoInvoiceProviderData provider) {
    Element gCamAE = el(doc, gDtipDE, "gCamAE", null);
    el(doc, gCamAE, "iNatVen", String.valueOf(provider.natureCode()));
    el(doc, gCamAE, "dDesNatVen", provider.natureCode() == 1 ? "No contribuyente" : "Extranjero");
    el(doc, gCamAE, "iTipIDVen", String.valueOf(provider.idTypeCode()));
    el(doc, gCamAE, "dDTipIDVen", identityDocumentTypeDescription(provider.idTypeCode()));
    el(doc, gCamAE, "dNumIDVen", provider.idNumber());
    el(doc, gCamAE, "dNomVen", provider.name());
    el(doc, gCamAE, "dDirVen", provider.address());
    el(doc, gCamAE, "dNumCasVen", provider.houseNumber());
    el(doc, gCamAE, "cDepVen", provider.departmentCode());
    el(doc, gCamAE, "dDesDepVen", provider.departmentName());
    el(doc, gCamAE, "cCiuVen", provider.cityCode());
    el(doc, gCamAE, "dDesCiuVen", provider.cityName());
    // dDirProv/cDepProv/cCiuProv ("lugar donde se realizó la operación"): reuses the provider's own
    // address — see SifenAutoInvoiceProviderData's javadoc for why this domain doesn't model a
    // separate "place of transaction".
    el(doc, gCamAE, "dDirProv", provider.address());
    el(doc, gCamAE, "cDepProv", provider.departmentCode());
    el(doc, gCamAE, "dDesDepProv", provider.departmentName());
    el(doc, gCamAE, "cCiuProv", provider.cityCode());
    el(doc, gCamAE, "dDesCiuProv", provider.cityName());
  }

  /**
   * E4/{@code dDTipIDVen} catálogo del proveedor de autofactura ({@link
   * #buildAutoInvoiceProviderGroup}) — narrower than D3/D209's receiver catalog (no códigos 5/6/9),
   * por eso no se reusa para el receptor: ver {@link ClientIdentityDocumentType#description()}.
   */
  private static String identityDocumentTypeDescription(int code) {
    return switch (code) {
      case 1 -> "Cédula paraguaya";
      case 2 -> "Pasaporte";
      case 3 -> "Cédula extranjera";
      case 4 -> "Carnet de residencia";
      case 5 -> "Innominado";
      case 6 -> "Tarjeta Diplomática de exoneración fiscal";
      default -> "Otro";
    };
  }

  /** gCamNCDE — SIFEN HU-14, nota de crédito/débito: motivo de emisión. */
  private void buildCreditDebitNoteMotiveGroup(
      Document doc, Element gDtipDE, SifenCreditDebitNoteData note) {
    Element gCamNCDE = el(doc, gDtipDE, "gCamNCDE", null);
    el(doc, gCamNCDE, "iMotEmi", String.valueOf(note.reasonCode()));
    el(doc, gCamNCDE, "dDesMotEmi", creditDebitReasonDescription(note.reasonCode()));
  }

  private static String creditDebitReasonDescription(int code) {
    return switch (code) {
      case 1 -> "Devolución y Ajuste de precios";
      case 2 -> "Devolución";
      case 3 -> "Descuento";
      case 4 -> "Bonificación";
      case 5 -> "Crédito incobrable";
      case 6 -> "Recupero de costo";
      case 7 -> "Recupero de gasto";
      default -> "Ajuste de precio";
    };
  }

  /** gCamNRE — SIFEN HU-14, nota de remisión: motivo del traslado + responsable de la emisión. */
  private void buildGoodsRemissionMotiveGroup(
      Document doc, Element gDtipDE, SifenGoodsRemissionData remission) {
    Element gCamNRE = el(doc, gDtipDE, "gCamNRE", null);
    el(doc, gCamNRE, "iMotEmiNR", String.valueOf(remission.reasonCode()));
    el(doc, gCamNRE, "dDesMotEmiNR", goodsRemissionReasonDescription(remission.reasonCode()));
    el(doc, gCamNRE, "iRespEmiNR", String.valueOf(remission.responsibleCode()));
    el(
        doc,
        gCamNRE,
        "dDesRespEmiNR",
        goodsRemissionResponsibleDescription(remission.responsibleCode()));
    el(doc, gCamNRE, "dKmR", String.valueOf(remission.estimatedKm()));
  }

  private static String goodsRemissionReasonDescription(int code) {
    return switch (code) {
      case 1 -> "Traslado por ventas";
      case 2 -> "Traslado por consignación";
      case 3 -> "Exportación";
      case 4 -> "Traslado por compra";
      case 5 -> "Importación";
      case 6 -> "Traslado por devolución";
      case 7 -> "Traslado entre locales de la empresa";
      case 8 -> "Traslado de bienes por transformación";
      case 9 -> "Traslado de bienes para reparación";
      case 10 -> "Traslado por emisor móvil";
      case 11 -> "Exhibición o Demostración";
      case 12 -> "Participación en ferias";
      case 13 -> "Traslado de encomienda";
      case 14 -> "Decomiso";
      default -> "Otro";
    };
  }

  private static String goodsRemissionResponsibleDescription(int code) {
    return switch (code) {
      case 1 -> "Emisor de la factura";
      case 2 -> "Poseedor de la factura y bienes";
      case 3 -> "Empresa transportista";
      case 4 -> "Despachante de Aduanas";
      default -> "Agente de transporte o intermediario";
    };
  }

  /** gTransp — SIFEN HU-14, nota de remisión: modalidad de transporte + responsable del flete. */
  private void buildTransportGroup(
      Document doc,
      Element gDtipDE,
      SifenGoodsRemissionData remission,
      LocalDate issueDate,
      SifenIssuerData issuer) {
    Element gTransp = el(doc, gDtipDE, "gTransp", null);
    // SIFEN HU-14 gap found live (dCodRes=2102): iTipTrans/dDesTipTrans (E901/E902) are
    // minOccurs="0" in the XSD but mandatory by content rule for nota de remisión — must precede
    // iModTrans in tgTransp's real sequence (DE_v150.xsd).
    el(doc, gTransp, "iTipTrans", String.valueOf(remission.transportTypeCode()));
    el(doc, gTransp, "dDesTipTrans", remission.transportTypeCode() == 1 ? "Propio" : "Tercero");
    el(doc, gTransp, "iModTrans", String.valueOf(remission.transportModeCode()));
    el(doc, gTransp, "dDesModTrans", transportModeDescription(remission.transportModeCode()));
    el(doc, gTransp, "iRespFlete", String.valueOf(remission.freightResponsibleCode()));
    // SIFEN HU-14 gap found live (dCodRes=2107/2109): dIniTras/dFinTras (E909/E910, fecha
    // estimada de inicio/fin de traslado) are minOccurs="0" in the XSD but mandatory by content
    // rule for nota de remisión — same issue date for both (E910a only requires end >= start,
    // and a same-day local delivery is the realistic default for this domain).
    el(doc, gTransp, "dIniTras", issueDate.format(DATE_FORMAT));
    el(doc, gTransp, "dFinTras", issueDate.format(DATE_FORMAT));
    // SIFEN HU-14 gap found live (dCodRes=2150): gCamSal (E920-E939, local de salida de las
    // mercaderías) is minOccurs="0" in the XSD but mandatory by content rule for nota de
    // remisión — this domain has no separate "warehouse" concept, so goods are modeled as
    // departing from the emisor's own registered address.
    Element gCamSal = el(doc, gTransp, "gCamSal", null);
    el(doc, gCamSal, "dDirLocSal", issuer.address());
    el(doc, gCamSal, "dNumCasSal", "0");
    el(doc, gCamSal, "cDepSal", issuer.departmentCode());
    el(doc, gCamSal, "dDesDepSal", issuer.departmentName());
    el(doc, gCamSal, "cCiuSal", issuer.cityCode());
    el(doc, gCamSal, "dDesCiuSal", issuer.cityName());
    // SIFEN HU-14 gap found live (dCodRes=2200): gCamEnt (E940-E959, local de entrega), the
    // delivery-side counterpart to gCamSal above, is also mandatory by content rule — this domain
    // has no distinct destination address (Client.department/city are free text, not DNIT catalog
    // codes, per buildReceiver's own documented gap), so it reuses the emisor's own address too.
    Element gCamEnt = el(doc, gTransp, "gCamEnt", null);
    el(doc, gCamEnt, "dDirLocEnt", issuer.address());
    el(doc, gCamEnt, "dNumCasEnt", "0");
    el(doc, gCamEnt, "cDepEnt", issuer.departmentCode());
    el(doc, gCamEnt, "dDesDepEnt", issuer.departmentName());
    el(doc, gCamEnt, "cCiuEnt", issuer.cityCode());
    el(doc, gCamEnt, "dDesCiuEnt", issuer.cityName());
    // SIFEN HU-14 gap found live (dCodRes=2250): gVehTras (E960-E979, vehículo de traslado) is
    // also mandatory by content rule — this domain has no fleet/vehicle model, so a single
    // generic occurrence is emitted with only the 3 fields the real schema doesn't mark
    // minOccurs="0" (dTiVehTras/dMarVeh/dTipIdenVeh); everything else in tgVehTras is optional —
    // except dNroIDVeh (E963), which dCodRes=2255 revealed becomes mandatory once
    // dTipIdenVeh=1 ("Se requiere el número de identificación del vehículo... cuando E967=1").
    Element gVehTras = el(doc, gTransp, "gVehTras", null);
    el(doc, gVehTras, "dTiVehTras", "Camioneta");
    el(doc, gVehTras, "dMarVeh", "Generico");
    el(doc, gVehTras, "dTipIdenVeh", "1");
    el(doc, gVehTras, "dNroIDVeh", "SIN-DATOS");
    // SIFEN HU-14 gap found live (dCodRes=2300): gCamTrans (E980-E999, transportista), the last
    // sub-group in tgTransp's real sequence, is also mandatory by content rule — modeled as a
    // "no contribuyente" transportista (iNatTrans=2) to avoid needing a real RUC, same reasoning
    // as autofactura's provider (dCodRes=2562's live-confirmed collision risk).
    Element gCamTrans = el(doc, gTransp, "gCamTrans", null);
    el(doc, gCamTrans, "iNatTrans", "2");
    el(doc, gCamTrans, "dNomTrans", "Transportista Genérico");
    // SIFEN HU-14 gap found live (dCodRes=2307): iTipIDTrans/dDTipIDTrans/dNumIDTrans are
    // minOccurs="0" in the XSD but mandatory by content rule once the transportista isn't a
    // contribuyente (iNatTrans=2) — same D208/D209 pattern already fixed for the receiver
    // (dCodRes=1313).
    el(doc, gCamTrans, "iTipIDTrans", "1");
    el(doc, gCamTrans, "dDTipIDTrans", identityDocumentTypeDescription(1));
    el(doc, gCamTrans, "dNumIDTrans", "0000000");
    el(doc, gCamTrans, "dNumIDChof", "0000000");
    el(doc, gCamTrans, "dNomChof", "Chofer Genérico");
    el(doc, gCamTrans, "dDomFisc", issuer.address());
    el(doc, gCamTrans, "dDirChof", issuer.address());
  }

  private static String transportModeDescription(int code) {
    return switch (code) {
      case 1 -> "Terrestre";
      case 2 -> "Fluvial";
      case 3 -> "Aéreo";
      default -> "Multimodal";
    };
  }

  /**
   * gCamDEAsoc — SIFEN HU-14, nota de crédito/débito (AC-03): referencia a la factura previamente
   * aprobada, a nivel de documento (hermano de {@code gTotSub} bajo {@code <DE>}, confirmado contra
   * el schema real). {@code iTipDocAso} queda fijo en {@code 1} ("Electrónico") porque este dominio
   * nunca asocia un documento impreso ni una constancia electrónica, solo un DE real ya aprobado
   * por SIFEN.
   */
  private void buildAssociatedDocumentGroup(
      Document doc, Element de, SifenDocumentTypeExtras extras, SifenInvoiceHeader header) {
    if (extras.autoInvoiceProvider() != null) {
      // SIFEN HU-14 gap found live (dCodRes=2400, refined by dCodRes=2416): gCamDEAsoc is
      // mandatory for autofactura too, not just NC/ND — but specifically as "Constancia
      // Electrónica" (iTipDocAso=3), never "Electrónico" (a real prior DE, which doesn't exist
      // here) nor "Impreso" (rejected live: 2416 requires exactly H002=3 for C002=4). tdTipCons=1
      // ("Constancia de no ser contribuyente") is the one that actually matches what an
      // autofactura represents — a purchase from someone who isn't a contribuyente.
      Element gCamDEAsoc = el(doc, de, "gCamDEAsoc", null);
      el(doc, gCamDEAsoc, "iTipDocAso", "3");
      el(doc, gCamDEAsoc, "dDesTipDocAso", "Constancia Electrónica");
      el(doc, gCamDEAsoc, "iTipCons", "1");
      el(doc, gCamDEAsoc, "dDesTipCons", "Constancia de no ser contribuyente");
      el(doc, gCamDEAsoc, "dNumCons", "00000000001");
      return;
    }
    String referencedCdc;
    if (extras.creditDebitNote() != null) {
      referencedCdc = extras.creditDebitNote().referencedControlNumber();
    } else if (extras.goodsRemission() != null) {
      // SIFEN HU-14 gap found live (dCodRes=2605) — see SifenGoodsRemissionData's javadoc.
      referencedCdc = extras.goodsRemission().referencedControlNumber();
    } else {
      referencedCdc = null;
    }
    if (referencedCdc == null) {
      return;
    }
    Element gCamDEAsoc = el(doc, de, "gCamDEAsoc", null);
    el(doc, gCamDEAsoc, "iTipDocAso", "1");
    el(doc, gCamDEAsoc, "dDesTipDocAso", "Electrónico");
    el(doc, gCamDEAsoc, "dCdCDERef", referencedCdc);
  }

  /**
   * E8 (ítem). SIFEN HU-14 gaps found live: {@code gValorItem} (E720, precios/descuentos/total por
   * ítem) is forbidden for nota de remisión (dCodRes=1851, E720a) — a goods-movement document has
   * no per-item monetary value. {@code gCamIVA} (E730) is forbidden for both autofactura and nota
   * de remisión (dCodRes=1901, E730a) — neither represents a taxed sale in this DE's own right (an
   * autofactura's tax treatment lives elsewhere; a remisión has no operación comercial at all, same
   * reasoning {@code buildGeneralDataGroup} already applies to omit {@code gOpeCom} for it).
   */
  private void buildItem(
      Document doc, Element gDtipDE, SifenInvoiceLine line, SifenDocumentTypeExtras extras) {
    boolean isGoodsRemission = extras.goodsRemission() != null;
    boolean isAutoInvoice = extras.autoInvoiceProvider() != null;

    Element gCamItem = el(doc, gDtipDE, "gCamItem", null);
    el(doc, gCamItem, "dCodInt", line.internalCode());
    el(doc, gCamItem, "dDesProSer", line.description());
    el(doc, gCamItem, "cUniMed", line.unitOfMeasureCode());
    // SIFEN HU-13 gap fix: dDesUniMed (E710) is a closed enumeration (Unidades_Medida_v141.xsd,
    // tdDesUniMed) keyed to the *abbreviation* the manual's own Tabla 5 publishes for each cUniMed
    // code — "UNI" for code 77 (Unidad), never the free-text description "Unidad" this used to
    // send.
    // Confirmed directly against the real production XSD (2026-07-28): "Unidad" isn't one of the
    // enumeration's literals, only "UNI" is — every public SIFEN XML generator/example agrees.
    el(doc, gCamItem, "dDesUniMed", "UNI");
    el(doc, gCamItem, "dCantProSer", String.valueOf(line.quantity()));
    if (line.additionalInfo() != null) {
      el(doc, gCamItem, "dInfItem", line.additionalInfo());
    }

    if (!isGoodsRemission) {
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
    }

    if (!isGoodsRemission && !isAutoInvoice) {
      Element gCamIVA = el(doc, gCamItem, "gCamIVA", null);
      el(doc, gCamIVA, "iAfecIVA", String.valueOf(line.taxAffectation().sifenCode()));
      el(doc, gCamIVA, "dDesAfecIVA", taxAffectationDescription(line.taxAffectation()));
      el(doc, gCamIVA, "dPropIVA", line.taxProportion().toPlainString());
      el(doc, gCamIVA, "dTasaIVA", line.taxRatePercent().toPlainString());
      el(doc, gCamIVA, "dBasGravIVA", line.taxableBase().toPlainString());
      el(doc, gCamIVA, "dLiqIVAItem", line.taxAmount().toPlainString());
      // SIFEN HU-13 gap fix: dBasExe (E737, "base exenta por ítem") is a required child of
      // gCamIVA — confirmed directly against the real production schema (DE_v150.xsd, tgCamIVA
      // complexType, downloaded from https://ekuatia.set.gov.py/sifen/xsd/DE_v150.xsd
      // 2026-07-28), where it has no minOccurs="0" (always mandatory, unlike the manual's 2019
      // edition, which doesn't have this field at all — added later by NT-013). Must always be
      // present, "0" whenever the line isn't gravado-parcial (iAfecIVA=4); NT-013's formula
      // applies only for that affectation.
      el(doc, gCamIVA, "dBasExe", exemptBase(line).toPlainString());
    }
  }

  /**
   * NT-013's formula for E737/dBasExe, gravado-parcial (iAfecIVA=4) only: {@code [100 * dTotOpeItem
   * * (100 - dPropIVA)] / [10000 + (dTasaIVA * dPropIVA)]}. Every other affectation reports 0 —
   * this business never actually produces {@code GRAVADO_PARCIAL} lines today (see {@link
   * SifenTaxAffectation} javadoc: no split gravado/exento within one line is representable), so
   * this branch is exercised only by the unit test built for this fix, not by any real invoice yet.
   */
  private static BigDecimal exemptBase(SifenInvoiceLine line) {
    if (line.taxAffectation() != SifenTaxAffectation.GRAVADO_PARCIAL) {
      return BigDecimal.ZERO;
    }
    BigDecimal hundred = BigDecimal.valueOf(100);
    BigDecimal numerator =
        hundred.multiply(line.netTotal()).multiply(hundred.subtract(line.taxProportion()));
    BigDecimal denominator =
        BigDecimal.valueOf(10_000).add(line.taxRatePercent().multiply(line.taxProportion()));
    return numerator.divide(denominator, 8, RoundingMode.HALF_UP);
  }

  /**
   * F (subtotales/totales). {@code isAutoInvoice} gap found live (dCodRes=2377/F020a): SIFEN
   * cross-checks F018/F019/F020 (bases gravadas) against the sum of item-level {@code gCamIVA}
   * occurrences (E735) — but {@code buildItem} never emits {@code gCamIVA} for autofactura
   * (dCodRes=1901), so that sum is always 0. dSubExe (F002) has the same cross-check for E731=3
   * (exento) item occurrences — also always 0 for autofactura, confirmed live (dCodRes=2353):
   * reporting the real gross total there was itself wrong, not just the taxed buckets. Every
   * per-rate subtotal field zeros out; only dTotOpe/dTotGralOpe (the operation's real amount, not
   * tied to a per-item-rate breakdown) keep their genuine value.
   */
  private void buildTotals(
      Document doc, Element de, SifenInvoiceTotals totals, boolean isAutoInvoice) {
    Element gTotSub = el(doc, de, "gTotSub", null);
    el(doc, gTotSub, "dSubExe", isAutoInvoice ? "0" : totals.exemptSubtotal().toPlainString());
    el(doc, gTotSub, "dSubExo", "0");
    el(doc, gTotSub, "dSub5", isAutoInvoice ? "0" : totals.taxedSubtotal5().toPlainString());
    el(doc, gTotSub, "dSub10", isAutoInvoice ? "0" : totals.taxedSubtotal10().toPlainString());
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
    el(doc, gTotSub, "dIVA5", isAutoInvoice ? "0" : totals.iva5().toPlainString());
    el(doc, gTotSub, "dIVA10", isAutoInvoice ? "0" : totals.iva10().toPlainString());
    el(doc, gTotSub, "dTotIVA", isAutoInvoice ? "0" : totals.totalIva().toPlainString());
    el(doc, gTotSub, "dBaseGrav5", isAutoInvoice ? "0" : totals.taxableBase5().toPlainString());
    el(doc, gTotSub, "dBaseGrav10", isAutoInvoice ? "0" : totals.taxableBase10().toPlainString());
    el(
        doc,
        gTotSub,
        "dTBasGraIVA",
        isAutoInvoice ? "0" : totals.totalTaxableBase().toPlainString());
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

  /**
   * SIFEN HU-13 bonus finding: {@code EXONERADO}/{@code GRAVADO_PARCIAL} literals corrected to
   * match the real production schema's closed enumeration ({@code DE_Types_v150.xsd}, {@code
   * tdDesAfecIVA}, verified live 2026-07-28) — neither value is reachable today (see {@link
   * SifenTaxAffectation} javadoc), so this was latent, not something HU-13's live invoices could
   * have exercised, but it's the same manual-vs-schema divergence family as the 3 gaps this history
   * closes and costs nothing to fix alongside them. The manual (Art. 83- Ley 125/91) was superseded
   * by NT-010 (Art. 100 - Ley 6380/2019) without a corresponding manual reedition; "Gravado parcial
   * (Grav-Exento)" is missing the schema's space after the hyphen ("Grav- Exento").
   */
  private static String taxAffectationDescription(SifenTaxAffectation affectation) {
    return switch (affectation) {
      case GRAVADO -> "Gravado IVA";
      case EXONERADO -> "Exonerado (Art. 100 - Ley 6380/2019)";
      case EXENTO -> "Exento";
      case GRAVADO_PARCIAL -> "Gravado parcial (Grav- Exento)";
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
