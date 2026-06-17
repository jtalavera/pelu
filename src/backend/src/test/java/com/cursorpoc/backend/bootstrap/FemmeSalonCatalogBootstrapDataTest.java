package com.cursorpoc.backend.bootstrap;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.bootstrap.FemmeSalonCatalogBootstrapData.ProfessionalRow;
import org.junit.jupiter.api.Test;

class FemmeSalonCatalogBootstrapDataTest {

  /** HU-29 AC7: ISABEL ZYMANSCKI and MERCEDES AQUINO removed, GABRIELA added. */
  @Test
  void professionalsSeed_reflectsHu29Changes() {
    var names =
        FemmeSalonCatalogBootstrapData.PROFESSIONALS.stream()
            .map(ProfessionalRow::fullName)
            .toList();
    assertThat(names).contains("GABRIELA");
    assertThat(names).doesNotContain("ISABEL ZYMANSCKI", "MERCEDES AQUINO");
  }
}
