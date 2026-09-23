package com.cursorpoc.backend.service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * HU-12 AC-04 ("...un reporte que indica, por cada servicio, el resultado esperado y el resultado
 * obtenido") and the foundation the Fase 4 plan expects: HU-17 AC-05 asks for a report that
 * consolidates results across HU-13 through HU-17, so this accumulator is deliberately generic
 * (story id + free-text scenario + expected/actual + pass/fail) rather than specific to
 * connectivity checks — any later homologation story can add its own rows with {@link #add} and
 * either render its own report or fold into a consolidated one with {@link #combinedWith}. Kept
 * intentionally minimal: no persistence, no HTTP endpoint — this only needs to exist for the
 * lifetime of a JUnit test run that then prints/logs {@link #render()} and asserts {@link
 * #allPassed()}.
 */
public class SifenHomologationReport {

  public record Row(
      String story, String scenario, String expected, String actual, boolean passed) {}

  private final List<Row> rows = new ArrayList<>();

  public void add(String story, String scenario, String expected, String actual, boolean passed) {
    rows.add(new Row(story, scenario, expected, actual, passed));
  }

  public List<Row> rows() {
    return Collections.unmodifiableList(rows);
  }

  /** AC-05 (HU-13 and later): a report is only good news if every row's expectation was met. */
  public boolean allPassed() {
    return rows.stream().allMatch(Row::passed);
  }

  /** AC-04: a fixed-width, human-readable rendering suitable for test output/logs. */
  public String render() {
    StringBuilder sb = new StringBuilder();
    sb.append(
        String.format(
            "%-8s | %-55s | %-10s | %-10s | %s%n",
            "Historia", "Escenario", "Esperado", "Obtenido", "Resultado"));
    for (Row row : rows) {
      sb.append(
          String.format(
              "%-8s | %-55s | %-10s | %-10s | %s%n",
              row.story(),
              row.scenario(),
              row.expected(),
              row.actual(),
              row.passed() ? "OK" : "FALLO"));
    }
    return sb.toString();
  }

  /**
   * HU-17 AC-05 seam: folds this report's rows together with one or more other stories' reports
   * into a single consolidated report, without either side needing to know about the other's
   * internals.
   */
  public SifenHomologationReport combinedWith(SifenHomologationReport... others) {
    SifenHomologationReport combined = new SifenHomologationReport();
    combined.rows.addAll(this.rows);
    for (SifenHomologationReport other : others) {
      combined.rows.addAll(other.rows);
    }
    return combined;
  }
}
