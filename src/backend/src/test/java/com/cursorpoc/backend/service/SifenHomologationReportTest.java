package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** HU-12 AC-04: the report accumulator/render/merge contract, independent of any SIFEN call. */
class SifenHomologationReportTest {

  @Test
  void add_recordsRowsInInsertionOrder() {
    SifenHomologationReport report = new SifenHomologationReport();

    report.add("HU-12", "Envío inmediato (cert válido)", "ACCEPTED", "ACCEPTED", true);
    report.add("HU-12", "Envío inmediato (cert inválido)", "REJECTED", "REJECTED", true);

    assertThat(report.rows()).hasSize(2);
    assertThat(report.rows().get(0).scenario()).isEqualTo("Envío inmediato (cert válido)");
    assertThat(report.rows().get(1).scenario()).isEqualTo("Envío inmediato (cert inválido)");
  }

  @Test
  void allPassed_isTrue_whenEveryRowPassed() {
    SifenHomologationReport report = new SifenHomologationReport();
    report.add("HU-12", "a", "ACCEPTED", "ACCEPTED", true);
    report.add("HU-12", "b", "REJECTED", "REJECTED", true);

    assertThat(report.allPassed()).isTrue();
  }

  @Test
  void allPassed_isFalse_whenAnyRowFailed() {
    SifenHomologationReport report = new SifenHomologationReport();
    report.add("HU-12", "a", "ACCEPTED", "ACCEPTED", true);
    report.add("HU-12", "b", "REJECTED", "ACCEPTED", false);

    assertThat(report.allPassed()).isFalse();
  }

  @Test
  void render_includesEveryRowAndAResultColumn() {
    SifenHomologationReport report = new SifenHomologationReport();
    report.add("HU-12", "Envío inmediato (cert válido)", "ACCEPTED", "ACCEPTED", true);
    report.add("HU-12", "Registro de eventos (cert inválido)", "REJECTED", "ACCEPTED", false);

    String rendered = report.render();

    assertThat(rendered).contains("Envío inmediato (cert válido)");
    assertThat(rendered).contains("Registro de eventos (cert inválido)");
    assertThat(rendered).contains("OK");
    assertThat(rendered).contains("FALLO");
  }

  @Test
  void combinedWith_mergesRowsFromOtherReportsWithoutMutatingOriginals() {
    SifenHomologationReport hu12 = new SifenHomologationReport();
    hu12.add("HU-12", "a", "ACCEPTED", "ACCEPTED", true);
    SifenHomologationReport hu13 = new SifenHomologationReport();
    hu13.add("HU-13", "b", "APPROVED", "APPROVED", true);

    SifenHomologationReport combined = hu12.combinedWith(hu13);

    assertThat(combined.rows()).hasSize(2);
    assertThat(hu12.rows()).hasSize(1);
    assertThat(hu13.rows()).hasSize(1);
  }
}
