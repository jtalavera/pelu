package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.cursorpoc.backend.domain.enums.SifenClientIdentificationType;
import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;
import org.w3c.dom.Document;
import org.w3c.dom.Element;

/**
 * Exercises {@link SifenClientIdentificationEventXmlService} against the real, live "Evento de
 * Nominación" ({@code rGEveNom}) structure confirmed 2026-07-28 from SIFEN's real {@code
 * evento.wsdl.xsd1.xsd} — this event isn't documented anywhere in Manual Técnico V150 (see the
 * class Javadoc), so the live XSD is the sole source of truth for the field list below.
 */
class SifenClientIdentificationEventXmlServiceTest {

  private static final String CDC = "01011371528001001999990122026072811234567800";

  private final SifenClientIdentificationEventXmlService service =
      new SifenClientIdentificationEventXmlService();

  @Test
  void buildClientIdentificationEvent_producesTheRGesEveRootedStructure() {
    var data =
        new SifenClientIdentificationEventXmlService.ClientIdentificationData(
            SifenClientIdentificationType.PERSON, null, "4123456", "María Duarte", null, null);

    Document doc =
        service.buildClientIdentificationEvent(
            CDC, data, 1785258251L, LocalDateTime.of(2026, 7, 28, 15, 0));

    Element rGesEve = doc.getDocumentElement();
    assertThat(rGesEve.getLocalName()).isEqualTo("rGesEve");

    Element rEve = (Element) rGesEve.getElementsByTagNameNS("*", "rEve").item(0);
    assertThat(rEve).isNotNull();
    assertThat(rEve.getAttribute("Id")).isEqualTo("1785258251");
    assertThat(rEve.getParentNode()).isSameAs(rGesEve);
    assertThat(SifenXmlUtils.firstDescendantText(rEve, "dFecFirma"))
        .isEqualTo("2026-07-28T15:00:00");
    assertThat(SifenXmlUtils.firstDescendantText(rEve, "dVerFor")).isEqualTo("150");

    Element rGEveNom = SifenXmlUtils.firstDescendant(rEve, "rGEveNom");
    assertThat(rGEveNom).isNotNull();
    assertThat(SifenXmlUtils.firstDescendantText(rGEveNom, "Id")).isEqualTo(CDC);
  }

  @Test
  void buildClientIdentificationEvent_company_emitsRucAndB2BOperationType() {
    var data =
        new SifenClientIdentificationEventXmlService.ClientIdentificationData(
            SifenClientIdentificationType.COMPANY,
            "80000005-6",
            null,
            "Comercial ABC S.A.",
            null,
            null);

    Document doc = service.buildClientIdentificationEvent(CDC, data, 1L, LocalDateTime.now());
    Element rGEveNom = SifenXmlUtils.firstDescendant(doc.getDocumentElement(), "rGEveNom");

    assertThat(SifenXmlUtils.firstDescendantText(rGEveNom, "iNatRec")).isEqualTo("1");
    assertThat(SifenXmlUtils.firstDescendantText(rGEveNom, "iTiOpe")).isEqualTo("1");
    assertThat(SifenXmlUtils.firstDescendantText(rGEveNom, "iTiContRec")).isEqualTo("2");
    assertThat(SifenXmlUtils.firstDescendantText(rGEveNom, "dRucRec")).isEqualTo("80000005");
    assertThat(SifenXmlUtils.firstDescendantText(rGEveNom, "dDVRec")).isEqualTo("6");
    assertThat(SifenXmlUtils.firstDescendantText(rGEveNom, "cPaisRec")).isEqualTo("PRY");
    assertThat(SifenXmlUtils.firstDescendantText(rGEveNom, "dDesPaisRe")).isEqualTo("Paraguay");
    assertThat(SifenXmlUtils.firstDescendantText(rGEveNom, "dNomRec"))
        .isEqualTo("Comercial ABC S.A.");
  }

  @Test
  void buildClientIdentificationEvent_person_emitsIdentityDocumentAndB2COperationType() {
    var data =
        new SifenClientIdentificationEventXmlService.ClientIdentificationData(
            SifenClientIdentificationType.PERSON, null, "4123456", "María Duarte", null, null);

    Document doc = service.buildClientIdentificationEvent(CDC, data, 1L, LocalDateTime.now());
    Element rGEveNom = SifenXmlUtils.firstDescendant(doc.getDocumentElement(), "rGEveNom");

    assertThat(SifenXmlUtils.firstDescendantText(rGEveNom, "iNatRec")).isEqualTo("2");
    assertThat(SifenXmlUtils.firstDescendantText(rGEveNom, "iTiOpe")).isEqualTo("2");
    assertThat(SifenXmlUtils.firstDescendantText(rGEveNom, "iTipIDRec")).isEqualTo("1");
    assertThat(SifenXmlUtils.firstDescendantText(rGEveNom, "dDTipIDRec"))
        .isEqualTo("Cédula paraguaya");
    assertThat(SifenXmlUtils.firstDescendantText(rGEveNom, "dNumIDRec")).isEqualTo("4123456");
    assertThat(SifenXmlUtils.firstDescendant(rGEveNom, "dRucRec")).isNull();
  }

  @Test
  void buildClientIdentificationEvent_foreign_emitsCountryAddressAndB2FOperationType() {
    var data =
        new SifenClientIdentificationEventXmlService.ClientIdentificationData(
            SifenClientIdentificationType.FOREIGN,
            null,
            "AB123456",
            "John Smith",
            "5th Avenue 123, New York",
            "USA");

    Document doc = service.buildClientIdentificationEvent(CDC, data, 1L, LocalDateTime.now());
    Element rGEveNom = SifenXmlUtils.firstDescendant(doc.getDocumentElement(), "rGEveNom");

    assertThat(SifenXmlUtils.firstDescendantText(rGEveNom, "iTiOpe")).isEqualTo("4");
    assertThat(SifenXmlUtils.firstDescendantText(rGEveNom, "cPaisRec")).isEqualTo("USA");
    assertThat(SifenXmlUtils.firstDescendantText(rGEveNom, "dDesPaisRe"))
        .isEqualTo("Estados Unidos de América");
    assertThat(SifenXmlUtils.firstDescendantText(rGEveNom, "iTipIDRec")).isEqualTo("2");
    assertThat(SifenXmlUtils.firstDescendantText(rGEveNom, "dDTipIDRec")).isEqualTo("Pasaporte");
    assertThat(SifenXmlUtils.firstDescendantText(rGEveNom, "dDirRec"))
        .isEqualTo("5th Avenue 123, New York");
  }

  @Test
  void buildClientIdentificationEvent_neverEmitsDTiGDE_matchingTheRealLiveXsd() {
    var data =
        new SifenClientIdentificationEventXmlService.ClientIdentificationData(
            SifenClientIdentificationType.PERSON, null, "4123456", "María Duarte", null, null);

    Document doc = service.buildClientIdentificationEvent(CDC, data, 1L, LocalDateTime.now());
    assertThat(SifenDocumentXmlService.serialize(doc)).doesNotContain("dTiGDE");
  }

  @Test
  void buildClientIdentificationEvent_rejectsABlankCdc() {
    var data =
        new SifenClientIdentificationEventXmlService.ClientIdentificationData(
            SifenClientIdentificationType.PERSON, null, "4123456", "María Duarte", null, null);

    assertThatThrownBy(
            () -> service.buildClientIdentificationEvent(" ", data, 1L, LocalDateTime.now()))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void buildClientIdentificationEvent_rejectsAnUnknownCountryCode() {
    var data =
        new SifenClientIdentificationEventXmlService.ClientIdentificationData(
            SifenClientIdentificationType.FOREIGN,
            null,
            "AB123456",
            "John Smith",
            "Somewhere",
            "ZZZ");

    assertThatThrownBy(
            () -> service.buildClientIdentificationEvent(CDC, data, 1L, LocalDateTime.now()))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
