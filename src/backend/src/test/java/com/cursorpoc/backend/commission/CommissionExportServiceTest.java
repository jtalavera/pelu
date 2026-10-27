package com.cursorpoc.backend.commission;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.web.dto.CommissionDtos.SettlementView;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The commission exports follow the UI language: column headers and status / type labels. */
class CommissionExportServiceTest {

  private final CommissionExportService service = new CommissionExportService(null, null);

  private static final SettlementView PAID =
      new SettlementView(
          7L,
          3L,
          "Ana",
          LocalDate.of(2026, 10, 1),
          LocalDate.of(2026, 10, 31),
          "PAID",
          new BigDecimal("40000"),
          Instant.EPOCH,
          null,
          null,
          "CASH",
          null,
          null);

  @Test
  void settlementsCsvIsInSpanishByDefault() {
    String csv = new String(service.settlementsCsv(List.of(PAID), null), StandardCharsets.UTF_8);
    assertThat(csv)
        .contains(
            "ID liquidación,Profesional,Periodo desde,Periodo hasta,Estado,Total,Medio de pago,Referencia de pago");
    assertThat(csv).contains("7,Ana,2026-10-01,2026-10-31,Pagada,40000,CASH,");
    assertThat(csv).doesNotContain("settlement_id");
  }

  @Test
  void settlementsCsvInEnglishWhenAsked() {
    String csv = new String(service.settlementsCsv(List.of(PAID), "en"), StandardCharsets.UTF_8);
    assertThat(csv)
        .contains(
            "Settlement ID,Professional,Period from,Period to,Status,Total,Payment method,Payment reference");
    assertThat(csv).contains(",Paid,");
  }

  @Test
  void labelsCoverEntryValuesInBothLanguages() {
    CommissionExportLabels es = CommissionExportLabels.of("es-PY");
    CommissionExportLabels en = CommissionExportLabels.of("en-US");
    assertThat(es.entriesHeader()).contains("Tipo de ítem", "Base de cálculo", "Comisión");
    assertThat(en.entriesHeader()).contains("Item type", "Calculation base", "Commission");
    assertThat(es.kind("PRODUCT")).isEqualTo("Producto");
    assertThat(en.kind("PRODUCT")).isEqualTo("Product");
    assertThat(es.base("NET_OF_TAX")).isEqualTo("Sin IVA");
    assertThat(en.base("TAX_INCLUDED")).isEqualTo("Including VAT");
    assertThat(es.status(null)).isEqualTo("Sin liquidar");
    assertThat(en.sourceType("REVERSAL")).isEqualTo("Reversal");
    assertThat(es.reason("VOID")).isEqualTo("Anulación del comprobante");
  }
}
