package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;
import org.w3c.dom.Document;
import org.w3c.dom.Element;

/**
 * Exercises {@link SifenNumberVoidingEventXmlService} (HU-16 AC-02) against the real live {@code
 * evento.wsdl.xsd1.xsd}'s {@code trGeVeInu} structure — see the class Javadoc for the
 * field-by-field source.
 */
class SifenNumberVoidingEventXmlServiceTest {

  private final SifenNumberVoidingEventXmlService service = new SifenNumberVoidingEventXmlService();

  @Test
  void buildNumberVoidingEvent_producesTheRGesEveRootedStructure_withoutAnIdCdc() {
    Document doc =
        service.buildNumberVoidingEvent(
            "1137152",
            1,
            1,
            SifenDocumentType.FACTURA,
            5000,
            5010,
            "Saltos de numeración",
            1785258251L,
            LocalDateTime.of(2026, 7, 28, 15, 0));

    Element rGesEve = doc.getDocumentElement();
    assertThat(rGesEve.getLocalName()).isEqualTo("rGesEve");

    Element rEve = (Element) rGesEve.getElementsByTagNameNS("*", "rEve").item(0);
    assertThat(rEve.getAttribute("Id")).isEqualTo("1785258251");
    assertThat(SifenXmlUtils.firstDescendantText(rEve, "dFecFirma"))
        .isEqualTo("2026-07-28T15:00:00");
    assertThat(SifenXmlUtils.firstDescendantText(rEve, "dVerFor")).isEqualTo("150");

    Element rGeVeInu = SifenXmlUtils.firstDescendant(rEve, "rGeVeInu");
    assertThat(rGeVeInu).isNotNull();
    // AC-02 / sección 11.5: the one event in this domain with no Id/CDC field at all.
    assertThat(rGeVeInu.getElementsByTagNameNS("*", "Id").getLength()).isZero();
    assertThat(SifenXmlUtils.firstDescendantText(rGeVeInu, "dNumTim")).isEqualTo("01137152");
    assertThat(SifenXmlUtils.firstDescendantText(rGeVeInu, "dEst")).isEqualTo("001");
    assertThat(SifenXmlUtils.firstDescendantText(rGeVeInu, "dPunExp")).isEqualTo("001");
    assertThat(SifenXmlUtils.firstDescendantText(rGeVeInu, "dNumIn")).isEqualTo("0005000");
    assertThat(SifenXmlUtils.firstDescendantText(rGeVeInu, "dNumFin")).isEqualTo("0005010");
    assertThat(SifenXmlUtils.firstDescendantText(rGeVeInu, "iTiDE")).isEqualTo("1");
    assertThat(SifenXmlUtils.firstDescendantText(rGeVeInu, "mOtEve"))
        .isEqualTo("Saltos de numeración");
  }

  @Test
  void buildNumberVoidingEvent_mapsEachOfTheFiveRequiredDocumentTypes() {
    for (SifenDocumentType type : SifenDocumentType.values()) {
      Document doc =
          service.buildNumberVoidingEvent(
              "1137152", 1, 1, type, 1, 10, "Motivo válido", 1L, LocalDateTime.now());
      Element rGeVeInu = SifenXmlUtils.firstDescendant(doc.getDocumentElement(), "rGeVeInu");
      assertThat(SifenXmlUtils.firstDescendantText(rGeVeInu, "iTiDE"))
          .isEqualTo(String.valueOf(type.sifenCode()));
    }
  }

  @Test
  void buildNumberVoidingEvent_rejectsARangeEndBeforeRangeStart() {
    assertThatThrownBy(
            () ->
                service.buildNumberVoidingEvent(
                    "1137152",
                    1,
                    1,
                    SifenDocumentType.FACTURA,
                    100,
                    50,
                    "Motivo válido",
                    1L,
                    LocalDateTime.now()))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void buildNumberVoidingEvent_rejectsAReasonShorterThanFiveCharacters() {
    assertThatThrownBy(
            () ->
                service.buildNumberVoidingEvent(
                    "1137152",
                    1,
                    1,
                    SifenDocumentType.FACTURA,
                    1,
                    10,
                    "abcd",
                    1L,
                    LocalDateTime.now()))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void buildNumberVoidingEvent_neverEmitsXsiAttributesOnRGesEve() {
    Document doc =
        service.buildNumberVoidingEvent(
            "1137152",
            1,
            1,
            SifenDocumentType.FACTURA,
            1,
            10,
            "Motivo válido",
            1L,
            LocalDateTime.now());
    String xml = SifenDocumentXmlService.serialize(doc);
    // HU-16: xsi:schemaLocation belongs on gGroupGesEve (SifenEventClient), never on rGesEve itself
    // — the exact misplacement that produced the 0160 wall from HU-10 through HU-15.
    assertThat(xml).doesNotContain("xsi:schemaLocation");
  }
}
