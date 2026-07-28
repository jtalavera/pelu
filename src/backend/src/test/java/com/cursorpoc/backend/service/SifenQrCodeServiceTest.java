package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.config.SifenConnectionProperties;
import com.cursorpoc.backend.config.SifenQrProperties;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;

/**
 * SIFEN HU-08: {@link SifenQrCodeService} reproduces the Manual Técnico V150 sección 13.8.4 worked
 * example exactly (own CDC, DigestValue, totals, CSC and expected {@code cHashQR}) — the same kind
 * of manual-worked-example regression test HU-01 used for the CDC checksum. This is the strongest
 * available evidence the hash algorithm (field ordering, hex-encoding rule, SHA-256 over query +
 * raw CSC) is implemented correctly, independent of any interpretation risk.
 */
class SifenQrCodeServiceTest {

  /** The manual's own worked example (sección 13.8.4), reproduced field-by-field. */
  private static final String EXAMPLE_CDC = "01444444017001001001452822017012515873260988";

  private static final String EXAMPLE_DIGEST_BASE64 = "yzGYhUx1/XYYzksWB+fPR3Qc50c=";
  private static final String EXPECTED_HASH =
      "97ddbb3c1e7d65af03a70ffe21f2b34846ab1c89e0566c35222086766b7374ed";

  private SifenInvoiceHeader header(SifenReceiverData receiver) {
    SifenIssuerData issuer =
        new SifenIssuerData(
            "1137152",
            8,
            "Emisor Demo",
            null,
            "Avda. España 123",
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null);
    return new SifenInvoiceHeader(
        EXAMPLE_CDC,
        LocalDateTime.of(2017, 1, 25, 9, 35, 17),
        "1137152",
        1,
        1,
        LocalDate.of(2025, 1, 1),
        LocalDate.of(2027, 12, 31),
        issuer,
        receiver,
        false);
  }

  private static SifenInvoiceTotals totals(String netTotal, String totalIva) {
    BigDecimal value = new BigDecimal(netTotal);
    BigDecimal iva = new BigDecimal(totalIva);
    return new SifenInvoiceTotals(
        BigDecimal.ZERO,
        BigDecimal.ZERO,
        value,
        value,
        BigDecimal.ZERO,
        BigDecimal.ZERO,
        BigDecimal.ZERO,
        value,
        BigDecimal.ZERO,
        BigDecimal.ZERO,
        BigDecimal.ZERO,
        BigDecimal.ZERO,
        iva,
        iva);
  }

  /**
   * The manual's worked example uses "https://ekuatia.set.gov.py/consultas/qr?" (production) as the
   * QR image base even though the CSC it uses (IdCSC=0001) is a test CSC — an inconsistency in the
   * example itself, not ours; production environment is used here purely to match the manual's
   * literal expected URL/host for this regression case.
   */
  private SifenQrCodeService productionService() {
    SifenConnectionProperties connectionProperties = new SifenConnectionProperties();
    connectionProperties.setEnvironment(SifenConnectionProperties.Environment.PRODUCTION);
    return new SifenQrCodeService(new SifenQrProperties(), connectionProperties);
  }

  private SifenQrCodeService testService() {
    return new SifenQrCodeService(new SifenQrProperties(), new SifenConnectionProperties());
  }

  @Test
  void build_reproducesTheManualsWorkedExampleHashExactly() {
    SifenReceiverData receiver =
        new SifenReceiverData("88899990-1", null, "Cliente", null, null, null);
    SifenQrCodeService service = productionService();

    SifenQrCodeService.SifenQrResult result =
        service.build(header(receiver), totals("300000", "27272"), 2, EXAMPLE_DIGEST_BASE64);

    assertThat(result.qrUrl()).contains("cHashQR=" + EXPECTED_HASH);
  }

  @Test
  void build_reproducesTheManualsWorkedExampleUrlCharacterForCharacter() {
    SifenReceiverData receiver =
        new SifenReceiverData("88899990-1", null, "Cliente", null, null, null);
    SifenQrCodeService service = productionService();

    SifenQrCodeService.SifenQrResult result =
        service.build(header(receiver), totals("300000", "27272"), 2, EXAMPLE_DIGEST_BASE64);

    assertThat(result.qrUrl())
        .isEqualTo(
            "https://ekuatia.set.gov.py/consultas/qr?"
                + "nVersion=150&Id="
                + EXAMPLE_CDC
                + "&dFeEmiDE=323031372d30312d32355430393a33353a3137"
                + "&dRucRec=88899990"
                + "&dTotGralOpe=300000"
                + "&dTotIVA=27272"
                + "&cItems=2"
                + "&DigestValue=797a4759685578312f5859597a6b7357422b6650523351633530633d"
                + "&IdCSC=0001"
                + "&cHashQR="
                + EXPECTED_HASH);
    assertThat(result.productionEnvironment()).isTrue();
  }

  @Test
  void build_anonymousReceiver_usesDNumIDRecWithZero() {
    SifenReceiverData anonymous = new SifenReceiverData(null, null, "Sin Nombre", null, null, null);
    SifenQrCodeService service = testService();

    SifenQrCodeService.SifenQrResult result =
        service.build(header(anonymous), totals("100000", "9091"), 1, EXAMPLE_DIGEST_BASE64);

    assertThat(result.qrUrl()).contains("&dNumIDRec=0&");
    assertThat(result.qrUrl()).doesNotContain("dRucRec");
  }

  @Test
  void build_receiverIdentifiedByDocument_usesDNumIDRecWithTheDocumentNumber() {
    SifenReceiverData withDocument =
        new SifenReceiverData(null, "4123456", "Cliente Demo", null, null, null);
    SifenQrCodeService service = testService();

    SifenQrCodeService.SifenQrResult result =
        service.build(header(withDocument), totals("100000", "9091"), 1, EXAMPLE_DIGEST_BASE64);

    assertThat(result.qrUrl()).contains("&dNumIDRec=4123456&");
  }

  @Test
  void build_testEnvironment_usesTestConsultationHosts() {
    SifenReceiverData receiver = new SifenReceiverData(null, null, "Sin Nombre", null, null, null);
    SifenQrCodeService service = testService();

    SifenQrCodeService.SifenQrResult result =
        service.build(header(receiver), totals("100000", "9091"), 1, EXAMPLE_DIGEST_BASE64);

    assertThat(result.qrUrl()).startsWith("https://ekuatia.set.gov.py/consultas-test/qr?");
    assertThat(result.publicConsultationUrl())
        .isEqualTo("https://ekuatia.set.gov.py/consultas-test/");
    assertThat(result.productionEnvironment()).isFalse();
  }
}
