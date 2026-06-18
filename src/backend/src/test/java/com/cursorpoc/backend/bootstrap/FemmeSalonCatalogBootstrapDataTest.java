package com.cursorpoc.backend.bootstrap;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.bootstrap.FemmeSalonCatalogBootstrapData.ProfessionalRow;
import org.junit.jupiter.api.Test;

class FemmeSalonCatalogBootstrapDataTest {

  /**
   * HU-30 AC2: GABRIELA removed. HU-29 AC7: ISABEL ZYMANSCKI and MERCEDES AQUINO already removed.
   */
  @Test
  void professionalsSeed_reflectsHu30Changes() {
    var names =
        FemmeSalonCatalogBootstrapData.PROFESSIONALS.stream()
            .map(ProfessionalRow::fullName)
            .toList();
    assertThat(names).doesNotContain("GABRIELA", "ISABEL ZYMANSCKI", "MERCEDES AQUINO");
  }
}
