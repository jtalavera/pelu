package com.cursorpoc.backend.service;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;
import org.springframework.stereotype.Service;
import org.w3c.dom.Document;
import org.w3c.dom.Element;

/**
 * SIFEN HU-16 AC-03: assembles the four unsigned "eventos del receptor" — Notificación de
 * Recepción, Conformidad, Disconformidad and Desconocimiento (Manual Técnico V150 sección 11.5.2,
 * Tabla J filas 10-13) — registered by whoever <i>receives</i> a DTE, the mirror image of HU-10's
 * cancellation/HU-11's nominación (both registered by the <i>issuer</i>). This peluquería's real
 * operation never registers any of these on someone else's invoice — EP-05's homologación-only
 * scope, same as {@link SifenNumberVoidingEventXmlService}.
 *
 * <p>All four share the same {@code <rGesEve><rEve Id="eventId">...<gGroupTiEvt>...</gGroupTiEvt>
 * </rEve><Signature/></rGesEve>} shell every event in this domain uses (HU-10), differing only in
 * what {@code gGroupTiEvt} contains — confirmed against the real live {@code evento.wsdl.xsd1.xsd}
 * (2026-07-28), field-for-field consistent with the manual's own sección 11.5.2 tables:
 *
 * <ul>
 *   <li>{@code rGeVeNotRec} (Notificación – Recepción, GER GEN001-011): {@code Id} (CDC), {@code
 *       dFecEmi}/{@code dFecRecep}, {@code iTipRec} (1=Contribuyente/2=No Contribuyente), {@code
 *       dNomRec}, either {@code dRucRec}+{@code dDVRec} (iTipRec=1) or {@code dTipIDRec}+{@code
 *       dNumID} (iTipRec=2), {@code dTotalGs}.
 *   <li>{@code rGeVeConf} (Conformidad, GER GCO001-004): {@code Id}, {@code iTipConf} (1=total,
 *       2=parcial), {@code dFecRecep} only when {@code iTipConf=2} (manual: "Obligatorio si el tipo
 *       de Conformidad es Conformidad Parcial").
 *   <li>{@code rGeVeDisconf} (Disconformidad, GER GDI001-004): {@code Id}, {@code mOtEve} — the
 *       simplest of the four, just a CDC and a free-text reason.
 *   <li>{@code rGeVeDescon} (Desconocimiento, GER GED001-009): same receiver-identity shape as
 *       {@code rGeVeNotRec} ({@code dFecEmi}/{@code dFecRecep}/{@code iTipRec}/{@code dNomRec}/RUC-
 *       or-document), but ends in {@code mOtEve} instead of {@code dTotalGs}.
 * </ul>
 *
 * <p><b>"Corregir un evento anterior" (AC-03's fifth action) is not a fifth XML shape.</b> Manual
 * Técnico V150's Tabla K ("Correcciones de los eventos del Receptor en el SIFEN", sección 11.5.2)
 * documents this as registering a <i>second</i> event — Conformidad, Disconformidad or
 * Desconocimiento again — over the same CDC, within 15 days of the first: "Solo se puede registrar
 * un evento de corrección sobre cada evento mencionado". So a correction reuses these same three
 * builders a second time; there is no separate {@code rGeVe*Correccion} element in the live XSD or
 * the manual. See {@code SifenHomologationEventsLiveTest} for how this is exercised.
 */
@Service
public class SifenReceptorEventXmlService {

  static final String SIFEN_NS = SifenDocumentXmlService.SIFEN_NS;

  private static final DateTimeFormatter DATE_TIME_FORMAT =
      DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss");

  static final int REASON_MIN_LENGTH = 5;

  static final int REASON_MAX_LENGTH = 500;

  /** GEN005/GED005 — "1=Contribuyente, 2=No Contribuyente". */
  public enum ReceiverTaxpayerStatus {
    TAXPAYER,
    NON_TAXPAYER
  }

  /**
   * The receiver-identity fields {@code rGeVeNotRec}/{@code rGeVeDescon} both need: either a RUC (+
   * check digit) when {@code status} is {@link ReceiverTaxpayerStatus#TAXPAYER}, or a document type
   * code (1=Cédula paraguaya, 2=Pasaporte, 3=Cédula extranjera, 4=Carnet de residencia) + number
   * when {@link ReceiverTaxpayerStatus#NON_TAXPAYER} — mutually exclusive, mirroring GEN007-010/
   * GED007-010's own "No informar si..." rules.
   */
  public record ReceiverIdentity(
      ReceiverTaxpayerStatus status,
      String name,
      String ruc,
      Integer rucCheckDigit,
      Integer documentTypeCode,
      String documentNumber) {

    static ReceiverIdentity taxpayer(String name, String ruc, int rucCheckDigit) {
      return new ReceiverIdentity(
          ReceiverTaxpayerStatus.TAXPAYER, name, ruc, rucCheckDigit, null, null);
    }

    static ReceiverIdentity nonTaxpayer(String name, int documentTypeCode, String documentNumber) {
      return new ReceiverIdentity(
          ReceiverTaxpayerStatus.NON_TAXPAYER, name, null, null, documentTypeCode, documentNumber);
    }
  }

  /** GCO003 — "1=Conformidad Total, 2=Conformidad Parcial". */
  public enum ConformityType {
    TOTAL,
    PARTIAL
  }

  /** GER: Notificación – Recepción DE/DTE (Tabla J fila 10). */
  public Document buildReceptionNotification(
      String cdc,
      LocalDateTime issueDateTime,
      LocalDateTime receptionDateTime,
      ReceiverIdentity receiver,
      BigDecimal totalGs,
      long eventId,
      LocalDateTime signedAt) {
    requireCdc(cdc);
    Document doc = newEventDocument(eventId, signedAt);
    Element rGeVeNotRec = el(doc, gGroupTiEvt(doc), "rGeVeNotRec", null);
    el(doc, rGeVeNotRec, "Id", cdc);
    el(doc, rGeVeNotRec, "dFecEmi", formatDateTime(issueDateTime));
    el(doc, rGeVeNotRec, "dFecRecep", formatDateTime(receptionDateTime));
    appendReceiverIdentity(doc, rGeVeNotRec, receiver);
    el(doc, rGeVeNotRec, "dTotalGs", totalGs.toPlainString());
    return doc;
  }

  /** GER: Conformidad DTE (Tabla J fila 11). */
  public Document buildConformity(
      String cdc,
      ConformityType conformityType,
      LocalDateTime estimatedReceptionDate,
      long eventId,
      LocalDateTime signedAt) {
    requireCdc(cdc);
    if (conformityType == ConformityType.PARTIAL && estimatedReceptionDate == null) {
      throw new IllegalArgumentException(
          "estimatedReceptionDate is required when conformityType is PARTIAL (GCO004)");
    }
    Document doc = newEventDocument(eventId, signedAt);
    Element rGeVeConf = el(doc, gGroupTiEvt(doc), "rGeVeConf", null);
    el(doc, rGeVeConf, "Id", cdc);
    el(doc, rGeVeConf, "iTipConf", conformityType == ConformityType.TOTAL ? "1" : "2");
    if (conformityType == ConformityType.PARTIAL) {
      el(doc, rGeVeConf, "dFecRecep", formatDateTime(estimatedReceptionDate));
    }
    return doc;
  }

  /** GER: Disconformidad DTE (Tabla J fila 12) — also used to question ("cuestionar") a DTE. */
  public Document buildDisconformity(
      String cdc, String reason, long eventId, LocalDateTime signedAt) {
    requireCdc(cdc);
    String trimmedReason = requireReason(reason);
    Document doc = newEventDocument(eventId, signedAt);
    Element rGeVeDisconf = el(doc, gGroupTiEvt(doc), "rGeVeDisconf", null);
    el(doc, rGeVeDisconf, "Id", cdc);
    el(doc, rGeVeDisconf, "mOtEve", trimmedReason);
    return doc;
  }

  /** GER: Desconocimiento DE/DTE (Tabla J fila 13) — "desconocerla". */
  public Document buildDisavowal(
      String cdc,
      LocalDateTime issueDateTime,
      LocalDateTime receptionDateTime,
      ReceiverIdentity receiver,
      String reason,
      long eventId,
      LocalDateTime signedAt) {
    requireCdc(cdc);
    String trimmedReason = requireReason(reason);
    Document doc = newEventDocument(eventId, signedAt);
    Element rGeVeDescon = el(doc, gGroupTiEvt(doc), "rGeVeDescon", null);
    el(doc, rGeVeDescon, "Id", cdc);
    el(doc, rGeVeDescon, "dFecEmi", formatDateTime(issueDateTime));
    el(doc, rGeVeDescon, "dFecRecep", formatDateTime(receptionDateTime));
    appendReceiverIdentity(doc, rGeVeDescon, receiver);
    el(doc, rGeVeDescon, "mOtEve", trimmedReason);
    return doc;
  }

  private static void appendReceiverIdentity(
      Document doc, Element parent, ReceiverIdentity receiver) {
    boolean isTaxpayer = receiver.status() == ReceiverTaxpayerStatus.TAXPAYER;
    el(doc, parent, "iTipRec", isTaxpayer ? "1" : "2");
    el(doc, parent, "dNomRec", receiver.name());
    if (isTaxpayer) {
      el(doc, parent, "dRucRec", receiver.ruc());
      el(doc, parent, "dDVRec", String.valueOf(receiver.rucCheckDigit()));
    } else {
      el(doc, parent, "dTipIDRec", String.valueOf(receiver.documentTypeCode()));
      el(doc, parent, "dNumID", receiver.documentNumber());
    }
  }

  private static void requireCdc(String cdc) {
    if (cdc == null || cdc.isBlank()) {
      throw new IllegalArgumentException("cdc is required to build a receptor event");
    }
  }

  private static String requireReason(String reason) {
    if (reason == null || reason.trim().length() < REASON_MIN_LENGTH) {
      throw new IllegalArgumentException(
          "Reason must be at least " + REASON_MIN_LENGTH + " characters");
    }
    String trimmed = reason.trim();
    if (trimmed.length() > REASON_MAX_LENGTH) {
      throw new IllegalArgumentException(
          "Reason must be at most " + REASON_MAX_LENGTH + " characters");
    }
    return trimmed;
  }

  private static String formatDateTime(LocalDateTime dateTime) {
    return dateTime.truncatedTo(ChronoUnit.SECONDS).format(DATE_TIME_FORMAT);
  }

  /**
   * Builds the shared {@code <rGesEve><rEve
   * Id="eventId"><dFecFirma/><dVerFor/><gGroupTiEvt/></rEve> </rGesEve>} shell every event builder
   * in this class fills in — same shape as {@link SifenCancellationEventXmlService}/{@link
   * SifenNumberVoidingEventXmlService}. xmlns:xsi/ xsi:schemaLocation deliberately not set here —
   * see those classes' javadoc (HU-16's 0160 fix): they belong on {@code gGroupGesEve}, added by
   * {@link SifenEventClient#buildEnvelope}.
   */
  private static Document newEventDocument(long eventId, LocalDateTime signedAt) {
    Document doc = newDocument();
    Element rGesEve = doc.createElementNS(SIFEN_NS, "rGesEve");
    doc.appendChild(rGesEve);

    Element rEve = el(doc, rGesEve, "rEve", null);
    rEve.setAttribute("Id", String.valueOf(eventId));
    rEve.setIdAttribute("Id", true);

    el(doc, rEve, "dFecFirma", formatDateTime(signedAt));
    el(doc, rEve, "dVerFor", "150");
    el(doc, rEve, "gGroupTiEvt", null);
    return doc;
  }

  private static Element gGroupTiEvt(Document doc) {
    return (Element)
        doc.getDocumentElement().getElementsByTagNameNS(SIFEN_NS, "gGroupTiEvt").item(0);
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
      factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
      DocumentBuilder builder = factory.newDocumentBuilder();
      return builder.newDocument();
    } catch (ParserConfigurationException e) {
      throw new IllegalStateException("Failed to create a new XML document", e);
    }
  }
}
