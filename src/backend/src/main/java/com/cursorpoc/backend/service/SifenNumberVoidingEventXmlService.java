package com.cursorpoc.backend.service;

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
 * SIFEN HU-16 AC-02: assembles the unsigned "Inutilización de numeración" event ({@code rGeVeInu},
 * Manual Técnico V150 sección 11.6.2/Tabla J fila 2) — voids a range of document numbers that were
 * never actually issued, for one of the five document types the homologación requires (EP-05's
 * scope; this peluquería's real operation never voids a number).
 *
 * <p><b>The one event in this domain whose base identifier is not a CDC.</b> Sección 11.5 says it
 * plainly: "Para estructurar los diferentes eventos... se toma como elemento base al Código de
 * control (CDC), a excepción del evento de Inutilización de número de DE" — confirmed by the real
 * live XSD's {@code trGeVeInu} complex type, which has no {@code Id}/CDC field at all, only {@code
 * dNumTim/dEst/dPunExp/dNumIn/dNumFin/iTiDE/mOtEve/[dSerieNum]} (fetched 2026-07-28 from {@code
 * evento.wsdl.xsd1.xsd}, cross-checked against the manual's own field table, sección 11.6.2). This
 * is exactly why AC-02 doesn't need a prior SIFEN-approved document to exercise for real — unlike
 * AC-01/AC-03/AC-05, which do (see {@code SifenHomologationEventsLiveTest}'s javadoc).
 *
 * <p>Structure: {@code <rGesEve><rEve Id="eventId"><dFecFirma/><dVerFor/><gGroupTiEvt><rGeVeInu>
 * <dNumTim/><dEst/><dPunExp/><dNumIn/><dNumFin/><iTiDE/><mOtEve/></rGeVeInu></gGroupTiEvt></rEve>
 * <Signature/></rGesEve>} — same {@code <rGesEve>} shell as every other event in this domain
 * (HU-10/HU-11), same {@code SifenDocumentSigningService#signEvent} signing path. {@code dNumTim}
 * (8 digits, zero-padded — {@code tdNumTim}'s {@code minLength=maxLength=8}) and {@code
 * dEst}/{@code dPunExp} (3 digits) reuse the exact same {@code pad(...)} convention {@link
 * SifenDocumentXmlService#buildStampGroup} already established for the DE's own {@code gTimb}.
 * {@code iTiDE} reuses {@link SifenDocumentType} (HU-14) — the real catalog allows a couple of
 * codes this domain never builds documents for (e.g. 2, 3, 8), deliberately not exposed here.
 */
@Service
public class SifenNumberVoidingEventXmlService {

  static final String SIFEN_NS = SifenDocumentXmlService.SIFEN_NS;

  private static final DateTimeFormatter DATE_TIME_FORMAT =
      DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss");

  /** Same GEC003/mOtEve-shaped constraint (5-500 chars) every event in this domain shares. */
  static final int REASON_MIN_LENGTH = 5;

  static final int REASON_MAX_LENGTH = 500;

  /**
   * Builds the unsigned {@code <rGesEve>} document voiding document numbers {@code rangeStart}
   * through {@code rangeEnd} (inclusive) of {@code documentType}, under stamp {@code stampNumber}/
   * {@code establishment}/{@code expeditionPoint}. {@code eventId}/{@code signedAt} play the same
   * role as in every other event builder in this domain.
   */
  public Document buildNumberVoidingEvent(
      String stampNumber,
      int establishment,
      int expeditionPoint,
      SifenDocumentType documentType,
      long rangeStart,
      long rangeEnd,
      String reason,
      long eventId,
      LocalDateTime signedAt) {
    if (stampNumber == null || stampNumber.isBlank()) {
      throw new IllegalArgumentException("stampNumber is required to void a number range");
    }
    if (rangeEnd < rangeStart) {
      throw new IllegalArgumentException("rangeEnd must not be lower than rangeStart");
    }
    String trimmedReason = requireReason(reason);

    Document doc = newDocument();

    // HU-16: xmlns:xsi/xsi:schemaLocation go on gGroupGesEve (SifenEventClient#buildEnvelope), not
    // here — see SifenCancellationEventXmlService's javadoc for the full 0160 diagnosis this fixes.
    Element rGesEve = doc.createElementNS(SIFEN_NS, "rGesEve");
    doc.appendChild(rGesEve);

    Element rEve = el(doc, rGesEve, "rEve", null);
    rEve.setAttribute("Id", String.valueOf(eventId));
    rEve.setIdAttribute("Id", true);

    el(doc, rEve, "dFecFirma", signedAt.truncatedTo(ChronoUnit.SECONDS).format(DATE_TIME_FORMAT));
    el(doc, rEve, "dVerFor", "150");

    Element gGroupTiEvt = el(doc, rEve, "gGroupTiEvt", null);
    Element rGeVeInu = el(doc, gGroupTiEvt, "rGeVeInu", null);
    el(doc, rGeVeInu, "dNumTim", pad(stampNumber, 8));
    el(doc, rGeVeInu, "dEst", pad(establishment, 3));
    el(doc, rGeVeInu, "dPunExp", pad(expeditionPoint, 3));
    el(doc, rGeVeInu, "dNumIn", pad(rangeStart, 7));
    el(doc, rGeVeInu, "dNumFin", pad(rangeEnd, 7));
    el(doc, rGeVeInu, "iTiDE", String.valueOf(documentType.sifenCode()));
    el(doc, rGeVeInu, "mOtEve", trimmedReason);

    return doc;
  }

  private static String requireReason(String reason) {
    if (reason == null || reason.trim().length() < REASON_MIN_LENGTH) {
      throw new IllegalArgumentException(
          "Voiding reason must be at least " + REASON_MIN_LENGTH + " characters");
    }
    String trimmed = reason.trim();
    if (trimmed.length() > REASON_MAX_LENGTH) {
      throw new IllegalArgumentException(
          "Voiding reason must be at most " + REASON_MAX_LENGTH + " characters");
    }
    return trimmed;
  }

  private static String pad(String raw, int length) {
    return raw.length() >= length ? raw : "0".repeat(length - raw.length()) + raw;
  }

  private static String pad(long value, int length) {
    return pad(String.valueOf(value), length);
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
