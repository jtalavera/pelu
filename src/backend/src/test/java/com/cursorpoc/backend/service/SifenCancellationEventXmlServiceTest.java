package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;
import org.w3c.dom.Document;
import org.w3c.dom.Element;

/**
 * Exercises {@link SifenCancellationEventXmlService} against the exact structure confirmed live
 * (2026-07-28) from SIFEN's real {@code evento.wsdl.xsd1.xsd} — see the class Javadoc for the
 * manual-vs-real-schema deviation this reproduces ({@code dTiGDE} deliberately omitted).
 */
class SifenCancellationEventXmlServiceTest {

  private static final String CDC = "01011371528001001999990122026072811234567800";

  private final SifenCancellationEventXmlService service = new SifenCancellationEventXmlService();

  @Test
  void buildCancellationEvent_producesTheRGesEveRootedStructure() {
    Document doc =
        service.buildCancellationEvent(
            CDC, "Error en el monto facturado", 1785258251L, LocalDateTime.of(2026, 7, 28, 15, 0));

    Element rGesEve = doc.getDocumentElement();
    assertThat(rGesEve.getLocalName()).isEqualTo("rGesEve");

    Element rEve = (Element) rGesEve.getElementsByTagNameNS("*", "rEve").item(0);
    assertThat(rEve).isNotNull();
    assertThat(rEve.getAttribute("Id")).isEqualTo("1785258251");
    assertThat(rEve.getParentNode()).isSameAs(rGesEve);

    assertThat(SifenXmlUtils.firstDescendantText(rEve, "dFecFirma"))
        .isEqualTo("2026-07-28T15:00:00");
    assertThat(SifenXmlUtils.firstDescendantText(rEve, "dVerFor")).isEqualTo("150");

    Element rGeVeCan = SifenXmlUtils.firstDescendant(rEve, "rGeVeCan");
    assertThat(rGeVeCan).isNotNull();
    assertThat(SifenXmlUtils.firstDescendantText(rGeVeCan, "Id")).isEqualTo(CDC);
    assertThat(SifenXmlUtils.firstDescendantText(rGeVeCan, "mOtEve"))
        .isEqualTo("Error en el monto facturado");
  }

  /**
   * Manual/real-schema deviation (see class Javadoc): the manual documents GDE006/dTiGDE as
   * mandatory, but the real live XSD's trEve type has no such element — this must never be emitted.
   */
  @Test
  void buildCancellationEvent_neverEmitsDTiGDE_matchingTheRealLiveXsd() {
    Document doc = service.buildCancellationEvent(CDC, "Motivo válido", 1L, LocalDateTime.now());

    String xml = SifenDocumentXmlService.serialize(doc);
    assertThat(xml).doesNotContain("dTiGDE");
  }

  @Test
  void buildCancellationEvent_trimsAndAcceptsAFiveCharacterReason() {
    Document doc = service.buildCancellationEvent(CDC, "  abcde  ", 1L, LocalDateTime.now());

    Element rGeVeCan = SifenXmlUtils.firstDescendant(doc.getDocumentElement(), "rGeVeCan");
    assertThat(SifenXmlUtils.firstDescendantText(rGeVeCan, "mOtEve")).isEqualTo("abcde");
  }

  @Test
  void buildCancellationEvent_rejectsAReasonShorterThanFiveCharacters() {
    assertThatThrownBy(() -> service.buildCancellationEvent(CDC, "abcd", 1L, LocalDateTime.now()))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void buildCancellationEvent_rejectsAReasonLongerThan500Characters() {
    String tooLong = "x".repeat(501);
    assertThatThrownBy(() -> service.buildCancellationEvent(CDC, tooLong, 1L, LocalDateTime.now()))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void buildCancellationEvent_rejectsABlankCdc() {
    assertThatThrownBy(
            () -> service.buildCancellationEvent(" ", "Motivo válido", 1L, LocalDateTime.now()))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
