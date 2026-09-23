package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.cursorpoc.backend.service.SifenReceptorEventXmlService.ConformityType;
import com.cursorpoc.backend.service.SifenReceptorEventXmlService.ReceiverIdentity;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;
import org.w3c.dom.Document;
import org.w3c.dom.Element;

/**
 * Exercises {@link SifenReceptorEventXmlService} (HU-16 AC-03) against the real live {@code
 * evento.wsdl.xsd1.xsd}'s {@code trGeVeNotRec}/{@code trGeVeConf}/{@code trGeVeDisconf}/{@code
 * trGeVeDescon} structures — see the class Javadoc for the field-by-field source (Manual Técnico
 * V150 sección 11.5.2).
 */
class SifenReceptorEventXmlServiceTest {

  private static final String CDC = "01011371528001001999990122026072811234567800";

  private final SifenReceptorEventXmlService service = new SifenReceptorEventXmlService();

  @Test
  void buildReceptionNotification_producesTheExpectedStructure_forATaxpayerReceiver() {
    Document doc =
        service.buildReceptionNotification(
            CDC,
            LocalDateTime.of(2026, 7, 20, 10, 0),
            LocalDateTime.of(2026, 7, 21, 9, 0),
            ReceiverIdentity.taxpayer("Cliente Homologación", "1234567", 8),
            BigDecimal.valueOf(150000),
            1L,
            LocalDateTime.of(2026, 7, 28, 15, 0));

    Element rGesEve = doc.getDocumentElement();
    assertThat(rGesEve.getLocalName()).isEqualTo("rGesEve");
    Element rEve = SifenXmlUtils.firstDescendant(rGesEve, "rEve");
    Element rGeVeNotRec = SifenXmlUtils.firstDescendant(rEve, "rGeVeNotRec");
    assertThat(rGeVeNotRec).isNotNull();
    assertThat(SifenXmlUtils.firstDescendantText(rGeVeNotRec, "Id")).isEqualTo(CDC);
    assertThat(SifenXmlUtils.firstDescendantText(rGeVeNotRec, "dFecEmi"))
        .isEqualTo("2026-07-20T10:00:00");
    assertThat(SifenXmlUtils.firstDescendantText(rGeVeNotRec, "dFecRecep"))
        .isEqualTo("2026-07-21T09:00:00");
    assertThat(SifenXmlUtils.firstDescendantText(rGeVeNotRec, "iTipRec")).isEqualTo("1");
    assertThat(SifenXmlUtils.firstDescendantText(rGeVeNotRec, "dNomRec"))
        .isEqualTo("Cliente Homologación");
    assertThat(SifenXmlUtils.firstDescendantText(rGeVeNotRec, "dRucRec")).isEqualTo("1234567");
    assertThat(SifenXmlUtils.firstDescendantText(rGeVeNotRec, "dDVRec")).isEqualTo("8");
    assertThat(rGeVeNotRec.getElementsByTagNameNS("*", "dTipIDRec").getLength()).isZero();
    assertThat(SifenXmlUtils.firstDescendantText(rGeVeNotRec, "dTotalGs")).isEqualTo("150000");
  }

  @Test
  void buildReceptionNotification_usesDocumentFields_forANonTaxpayerReceiver() {
    Document doc =
        service.buildReceptionNotification(
            CDC,
            LocalDateTime.now(),
            LocalDateTime.now(),
            ReceiverIdentity.nonTaxpayer("Consumidor Final", 1, "4123456"),
            BigDecimal.TEN,
            1L,
            LocalDateTime.now());

    Element rGeVeNotRec = SifenXmlUtils.firstDescendant(doc.getDocumentElement(), "rGeVeNotRec");
    assertThat(SifenXmlUtils.firstDescendantText(rGeVeNotRec, "iTipRec")).isEqualTo("2");
    assertThat(SifenXmlUtils.firstDescendantText(rGeVeNotRec, "dTipIDRec")).isEqualTo("1");
    assertThat(SifenXmlUtils.firstDescendantText(rGeVeNotRec, "dNumID")).isEqualTo("4123456");
    assertThat(rGeVeNotRec.getElementsByTagNameNS("*", "dRucRec").getLength()).isZero();
  }

  @Test
  void buildConformity_total_omitsEstimatedReceptionDate() {
    Document doc =
        service.buildConformity(CDC, ConformityType.TOTAL, null, 1L, LocalDateTime.now());
    Element rGeVeConf = SifenXmlUtils.firstDescendant(doc.getDocumentElement(), "rGeVeConf");
    assertThat(SifenXmlUtils.firstDescendantText(rGeVeConf, "iTipConf")).isEqualTo("1");
    assertThat(rGeVeConf.getElementsByTagNameNS("*", "dFecRecep").getLength()).isZero();
  }

  @Test
  void buildConformity_partial_requiresAndEmitsEstimatedReceptionDate() {
    Document doc =
        service.buildConformity(
            CDC,
            ConformityType.PARTIAL,
            LocalDateTime.of(2026, 8, 1, 12, 0),
            1L,
            LocalDateTime.now());
    Element rGeVeConf = SifenXmlUtils.firstDescendant(doc.getDocumentElement(), "rGeVeConf");
    assertThat(SifenXmlUtils.firstDescendantText(rGeVeConf, "iTipConf")).isEqualTo("2");
    assertThat(SifenXmlUtils.firstDescendantText(rGeVeConf, "dFecRecep"))
        .isEqualTo("2026-08-01T12:00:00");
  }

  @Test
  void buildConformity_partial_rejectsAMissingEstimatedReceptionDate() {
    assertThatThrownBy(
            () ->
                service.buildConformity(CDC, ConformityType.PARTIAL, null, 1L, LocalDateTime.now()))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void buildDisconformity_producesJustIdAndReason() {
    Document doc =
        service.buildDisconformity(CDC, "El monto facturado no coincide", 1L, LocalDateTime.now());
    Element rGeVeDisconf = SifenXmlUtils.firstDescendant(doc.getDocumentElement(), "rGeVeDisconf");
    assertThat(SifenXmlUtils.firstDescendantText(rGeVeDisconf, "Id")).isEqualTo(CDC);
    assertThat(SifenXmlUtils.firstDescendantText(rGeVeDisconf, "mOtEve"))
        .isEqualTo("El monto facturado no coincide");
  }

  @Test
  void buildDisconformity_rejectsAReasonShorterThanFiveCharacters() {
    assertThatThrownBy(() -> service.buildDisconformity(CDC, "abcd", 1L, LocalDateTime.now()))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void buildDisavowal_producesTheExpectedStructure() {
    Document doc =
        service.buildDisavowal(
            CDC,
            LocalDateTime.of(2026, 7, 20, 10, 0),
            LocalDateTime.of(2026, 7, 21, 9, 0),
            ReceiverIdentity.taxpayer("Cliente Homologación", "1234567", 8),
            "Nunca recibí este documento",
            1L,
            LocalDateTime.now());
    Element rGeVeDescon = SifenXmlUtils.firstDescendant(doc.getDocumentElement(), "rGeVeDescon");
    assertThat(SifenXmlUtils.firstDescendantText(rGeVeDescon, "Id")).isEqualTo(CDC);
    assertThat(SifenXmlUtils.firstDescendantText(rGeVeDescon, "iTipRec")).isEqualTo("1");
    assertThat(SifenXmlUtils.firstDescendantText(rGeVeDescon, "dRucRec")).isEqualTo("1234567");
    assertThat(SifenXmlUtils.firstDescendantText(rGeVeDescon, "mOtEve"))
        .isEqualTo("Nunca recibí este documento");
  }

  @Test
  void allFourBuilders_rejectABlankCdc() {
    assertThatThrownBy(
            () -> service.buildConformity(" ", ConformityType.TOTAL, null, 1L, LocalDateTime.now()))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () -> service.buildDisconformity(" ", "Motivo válido", 1L, LocalDateTime.now()))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                service.buildDisavowal(
                    " ",
                    LocalDateTime.now(),
                    LocalDateTime.now(),
                    ReceiverIdentity.taxpayer("x", "1234567", 8),
                    "Motivo válido",
                    1L,
                    LocalDateTime.now()))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                service.buildReceptionNotification(
                    " ",
                    LocalDateTime.now(),
                    LocalDateTime.now(),
                    ReceiverIdentity.taxpayer("x", "1234567", 8),
                    BigDecimal.TEN,
                    1L,
                    LocalDateTime.now()))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void allFourBuilders_neverEmitXsiAttributesOnRGesEve() {
    Document doc = service.buildDisconformity(CDC, "Motivo válido", 1L, LocalDateTime.now());
    String xml = SifenDocumentXmlService.serialize(doc);
    assertThat(xml).doesNotContain("xsi:schemaLocation");
  }
}
