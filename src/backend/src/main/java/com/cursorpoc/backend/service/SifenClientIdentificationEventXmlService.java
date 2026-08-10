package com.cursorpoc.backend.service;

import com.cursorpoc.backend.domain.enums.SifenClientIdentificationType;
import com.cursorpoc.backend.util.ParaguayRucValidator;
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
 * SIFEN HU-11: assembles the unsigned "Evento de Nominación" document ({@code rGEveNom}) — the
 * event this system uses to identify, after the fact, the client on an invoice originally issued
 * without one (AC-01..AC-04).
 *
 * <p><b>This event does not exist anywhere in Manual Técnico V150</b> (neither its text — sección
 * 11's own event catalogue, Tabla J, lists exactly 8 numbered rows: 1, 2, 10, 11, 12, 13, 14, 16,
 * with no client/receptor-identification event among them, confirmed by rendering the actual table
 * page as an image since {@code pdftotext -layout} alone can't tell "row genuinely absent" from
 * "row lost to a layout artifact" — nor its {@code Evento_v150.xsd}'s {@code tgGroupEvt} choice,
 * which only has {@code rGeVeCan/rGeVeInu/rGeVeNotRec/rGeVeConf/rGeVeDisconf/rGeVeDescon/rGeVeEnd/
 * rGeVeTr}). This is the first HU in this integration where the manual is silent, not just
 * divergent (HU-10's {@code dTiGDE}/C14N findings were "manual says X, live XSD says Y" — this is
 * "manual says nothing at all").
 *
 * <p><b>Found instead by fetching the real, live {@code evento.wsdl.xsd1.xsd}</b> (same {@code curl
 * --cert-type P12} pattern as every prior story, 2026-07-28) — the live {@code tgGroupEvt} choice
 * has grown to 12 entries since the manual's 2019 edition, including {@code rGEveNom} ("Grupo de
 * Datos que identifican al Evento de Nominación", confirmed by its own XSD annotation). This lines
 * up with the well-documented real-world "Evento de Nominación" (a handful of public sources —
 * FacturaSend's own API docs, a GosSocket technical note about SIFEN's Nota Técnica No. 15 — talk
 * about this event by that exact name, but none publish its XML shape; the live XSD is the only
 * source used here for the actual field list/types/cardinality below).
 *
 * <p>Structure: {@code <rGesEve><rEve Id="eventId"><dFecFirma/><dVerFor/><gGroupTiEvt><rGEveNom>
 * <Id>cdc</Id><mOtEve>reason</mOtEve><iNatRec/><iTiOpe/><cPaisRec/><dDesPaisRe/>[iTiContRec]
 * [dRucRec][dDVRec][iTipIDRec][dDTipIDRec][dNumIDRec]<dNomRec/>[dDirRec]</rGEveNom></gGroupTiEvt>
 * </rEve><Signature/></rGesEve>} — same {@code <rGesEve>} shell HU-10's cancellation event already
 * established (root is {@code <rGesEve>} itself, {@code <Signature>} a sibling of {@code <rEve>},
 * signed via the same {@link SifenDocumentSigningService#signEvent}). The live {@code trGEveNom}
 * complex type also has optional {@code dNomFanRec}/{@code dNumCasRec}/department-district-city
 * codes/{@code dTelRec}/{@code dCelRec}/{@code dEmailRec}/{@code dCodCliente} — none of this
 * system's ACs need them (same kind of deliberate scope cut as {@code SifenDocumentXmlService
 * .buildReceiver}'s own department/city gap from HU-02), so none are emitted.
 */
@Service
public class SifenClientIdentificationEventXmlService {

  static final String SIFEN_NS = SifenDocumentXmlService.SIFEN_NS;

  private static final DateTimeFormatter DATE_TIME_FORMAT =
      DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss");

  /** Same GEC003/mOtEve constraint as the cancellation event (5-500 chars). */
  static final int REASON_MIN_LENGTH = 5;

  static final int REASON_MAX_LENGTH = 500;

  /** iTipIDRec — "Cédula paraguaya" per {@code tdDtipDocRec}'s enumeration in the live XSD. */
  private static final String PARAGUAYAN_ID_CODE = "1";

  private static final String PARAGUAYAN_ID_DESCRIPTION = "Cédula paraguaya";

  /** iTipIDRec — "Pasaporte", the default document type for a foreign identified client. */
  private static final String PASSPORT_CODE = "2";

  private static final String PASSPORT_DESCRIPTION = "Pasaporte";

  public record ClientIdentificationData(
      SifenClientIdentificationType clientType,
      String ruc,
      String identityDocumentNumber,
      String name,
      String address,
      String countryCode) {}

  /**
   * Builds the unsigned {@code <rGesEve>} document nominating {@code data} as the client on {@code
   * cdc}. {@code eventId}/{@code signedAt} play the exact same role as in {@link
   * SifenCancellationEventXmlService#buildCancellationEvent} (correlation id + signature instant).
   * The free-text {@code mOtEve} (mandatory per the live XSD, but not something any AC asks the
   * user for) is generated here rather than collected from the form.
   */
  public Document buildClientIdentificationEvent(
      String cdc, ClientIdentificationData data, long eventId, LocalDateTime signedAt) {
    if (cdc == null || cdc.isBlank()) {
      throw new IllegalArgumentException("cdc is required to build a client identification event");
    }
    Document doc = newDocument();

    // HU-16: see SifenCancellationEventXmlService's javadoc — xmlns:xsi/xsi:schemaLocation belong
    // on
    // gGroupGesEve (added by SifenEventClient#buildEnvelope), not here. This class inherited the
    // same misplacement from HU-10 at HU-11 time; fixed now that the real root cause of the
    // dCodRes=0160 wall is known.
    Element rGesEve = doc.createElementNS(SIFEN_NS, "rGesEve");
    doc.appendChild(rGesEve);

    Element rEve = el(doc, rGesEve, "rEve", null);
    rEve.setAttribute("Id", String.valueOf(eventId));
    rEve.setIdAttribute("Id", true);

    el(doc, rEve, "dFecFirma", signedAt.truncatedTo(ChronoUnit.SECONDS).format(DATE_TIME_FORMAT));
    el(doc, rEve, "dVerFor", "150");

    Element gGroupTiEvt = el(doc, rEve, "gGroupTiEvt", null);
    Element rGEveNom = el(doc, gGroupTiEvt, "rGEveNom", null);
    el(doc, rGEveNom, "Id", cdc);
    el(doc, rGEveNom, "mOtEve", reason(data));

    boolean hasRuc = !isBlank(data.ruc());
    el(doc, rGEveNom, "iNatRec", hasRuc ? "1" : "2");
    el(doc, rGEveNom, "iTiOpe", operationTypeCode(data.clientType()));

    if (data.clientType() == SifenClientIdentificationType.FOREIGN) {
      SifenForeignCountry country =
          SifenForeignCountry.fromCode(data.countryCode())
              .orElseThrow(
                  () ->
                      new IllegalArgumentException("Unknown country code: " + data.countryCode()));
      el(doc, rGEveNom, "cPaisRec", country.name());
      el(doc, rGEveNom, "dDesPaisRe", country.officialSpanishName());
    } else {
      el(doc, rGEveNom, "cPaisRec", "PRY");
      el(doc, rGEveNom, "dDesPaisRe", "Paraguay");
    }

    if (hasRuc) {
      ParaguayRucValidator.RucParts rucParts = ParaguayRucValidator.split(data.ruc());
      // AC-02: "empresa" -> Persona Jurídica (2), "persona" with a self-reported RUC -> Persona
      // Física (1) — unlike SifenDocumentXmlService.buildReceiver (HU-02), which has no source
      // field for this and always defaults to "1", this form's own clientType selector gives us the
      // real answer.
      el(
          doc,
          rGEveNom,
          "iTiContRec",
          data.clientType() == SifenClientIdentificationType.COMPANY ? "2" : "1");
      el(doc, rGEveNom, "dRucRec", rucParts.base());
      el(doc, rGEveNom, "dDVRec", String.valueOf(rucParts.checkDigit()));
    } else if (!isBlank(data.identityDocumentNumber())) {
      boolean foreign = data.clientType() == SifenClientIdentificationType.FOREIGN;
      el(doc, rGEveNom, "iTipIDRec", foreign ? PASSPORT_CODE : PARAGUAYAN_ID_CODE);
      el(doc, rGEveNom, "dDTipIDRec", foreign ? PASSPORT_DESCRIPTION : PARAGUAYAN_ID_DESCRIPTION);
      el(doc, rGEveNom, "dNumIDRec", data.identityDocumentNumber());
    }

    el(doc, rGEveNom, "dNomRec", data.name());
    if (!isBlank(data.address())) {
      el(doc, rGEveNom, "dDirRec", data.address());
    }

    return doc;
  }

  private static String reason(ClientIdentificationData data) {
    String base = "Identificación del cliente en factura emitida sin datos: " + data.name();
    if (base.length() > REASON_MAX_LENGTH) {
      return base.substring(0, REASON_MAX_LENGTH);
    }
    if (base.length() < REASON_MIN_LENGTH) {
      // Unreachable in practice (name is required and non-blank), but keeps this method's own
      // contract self-contained rather than relying on the caller never passing a 0-1 char name.
      return "Identificación del cliente en factura emitida sin datos.";
    }
    return base;
  }

  private static String operationTypeCode(SifenClientIdentificationType clientType) {
    return switch (clientType) {
      case COMPANY -> "1";
      case PERSON -> "2";
      case FOREIGN -> "4";
    };
  }

  private static boolean isBlank(String s) {
    return s == null || s.isBlank();
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
