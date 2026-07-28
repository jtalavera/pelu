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
 * SIFEN HU-10: assembles the unsigned cancellation event document ({@code rGeVeCan}, "Evento
 * Cancelación", Manual Técnico V150 sección 11.5.1) — the first event this integration builds,
 * ready for {@link SifenDocumentSigningService#signEvent} to sign.
 *
 * <p>Structure per the manual's Schema XML 13/19 and confirmed live (2026-07-28) against the real
 * {@code evento.wsdl.xsd1.xsd} (fetched from {@code
 * https://sifen-test.set.gov.py/de/ws/eventos/evento.wsdl.xsd1.xsd} with the pilot {@code .p12}):
 * {@code <rGesEve><rEve Id="eventId"><dFecFirma/><dVerFor/><gGroupTiEvt><rGeVeCan><Id>cdc</Id>
 * <mOtEve>reason</mOtEve></rGeVeCan></gGroupTiEvt></rEve><Signature/></rGesEve>}. The document root
 * here is {@code <rGesEve>} itself (not the outer {@code <gGroupGesEve>} wrapper, which the SOAP
 * client adds as plain string concatenation when building the envelope — same pattern {@link
 * SifenDocumentReceptionClient} already uses for {@code <xDE>}).
 *
 * <p><b>Manual/real-schema deviation found while building this (same family as HU-07's finding for
 * {@code SiConsDE}):</b> the manual's own field table (GDE006, sección 11.5) documents {@code
 * dTiGDE} ("Tipo de Evento") as a mandatory (1-1) sibling of {@code gGroupTiEvt} inside {@code
 * <rEve>}. The real, live XSD's {@code trEve} complex type has <b>no such element at all</b> — its
 * sequence is only {@code dFecFirma, dVerFor, gGroupTiEvt}, so the event type is conveyed entirely
 * by which element {@code gGroupTiEvt} actually contains ({@code rGeVeCan} for cancellation, a
 * {@code xs:choice} alongside every other emisor event type). Cross-checked against a real,
 * publicly maintained competing generator (TIPS-SA's {@code facturacionelectronicapy-xmlgen} npm
 * package, {@code JSonEventoMainService.generateXMLEventoCancelacion}): it also never emits {@code
 * dTiGDE} — independent confirmation this is a real, live SIFEN deviation from its own manual, not
 * a one-off quirk of the test environment. This class follows the real (live-verified) XSD, not the
 * manual's field table.
 *
 * <p>{@code rEve}'s own {@code Id} attribute (GDE003/{@code tdIdEve}: 1-10 digits, i.e. up to
 * 9999999999) is a sender-controlled correlation identifier for <i>this event</i>, unrelated to the
 * CDC it cancels — deliberately generated from epoch <b>seconds</b>, not milliseconds like the
 * envelope-level {@code dId} (whose {@code totalDigits} allows up to 15): epoch millis (13 digits
 * today) would already overflow {@code tdIdEve}'s 10-digit ceiling.
 */
@Service
public class SifenCancellationEventXmlService {

  static final String SIFEN_NS = SifenDocumentXmlService.SIFEN_NS;

  private static final String XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";

  private static final DateTimeFormatter DATE_TIME_FORMAT =
      DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss");

  /** GEC003/mOtEve — Manual Técnico V150 Schema XML 19: free text, 5 to 500 characters. */
  static final int REASON_MIN_LENGTH = 5;

  static final int REASON_MAX_LENGTH = 500;

  /**
   * Builds the unsigned {@code <rGesEve>} document for a cancellation event over {@code cdc}.
   * {@code eventId} becomes {@code rEve}'s {@code Id} attribute (the signature's reference anchor);
   * {@code signedAt} becomes GDE004/dFecFirma — the caller must pass the same instant it signs
   * with, mirroring {@link SifenDocumentXmlService#buildDocument}'s contract for the DE itself.
   */
  public Document buildCancellationEvent(
      String cdc, String reason, long eventId, LocalDateTime signedAt) {
    if (cdc == null || cdc.isBlank()) {
      throw new IllegalArgumentException("cdc is required to build a cancellation event");
    }
    if (reason == null || reason.trim().length() < REASON_MIN_LENGTH) {
      throw new IllegalArgumentException(
          "Cancellation reason must be at least " + REASON_MIN_LENGTH + " characters");
    }
    String trimmedReason = reason.trim();
    if (trimmedReason.length() > REASON_MAX_LENGTH) {
      throw new IllegalArgumentException(
          "Cancellation reason must be at most " + REASON_MAX_LENGTH + " characters");
    }

    Document doc = newDocument();

    Element rGesEve = doc.createElementNS(SIFEN_NS, "rGesEve");
    rGesEve.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns:xsi", XSI_NS);
    // Same requirement HU-04 found live for <rDE> (sección 7.2.2.1's worked example, confirmed live
    // 2026-07-28 that the real server rejects a missing/slash-joined schemaLocation with
    // dCodRes=0160): a space-separated namespace/schema-document pair, not the manual's own
    // slash-joined sección 7.2.2.1 example.
    rGesEve.setAttributeNS(XSI_NS, "xsi:schemaLocation", SIFEN_NS + " siRecepEvento_v150.xsd");
    doc.appendChild(rGesEve);

    Element rEve = el(doc, rGesEve, "rEve", null);
    rEve.setAttribute("Id", String.valueOf(eventId));
    rEve.setIdAttribute("Id", true);

    el(doc, rEve, "dFecFirma", signedAt.truncatedTo(ChronoUnit.SECONDS).format(DATE_TIME_FORMAT));
    el(doc, rEve, "dVerFor", "150");

    Element gGroupTiEvt = el(doc, rEve, "gGroupTiEvt", null);
    Element rGeVeCan = el(doc, gGroupTiEvt, "rGeVeCan", null);
    el(doc, rGeVeCan, "Id", cdc);
    el(doc, rGeVeCan, "mOtEve", trimmedReason);

    return doc;
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
}
