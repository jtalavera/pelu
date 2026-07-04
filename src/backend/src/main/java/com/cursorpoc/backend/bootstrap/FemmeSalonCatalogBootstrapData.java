package com.cursorpoc.backend.bootstrap;

import java.util.List;

/**
 * Hard-coded salon staff extracted from {@code Femme-Datos entrada.xlsx}. Services, service
 * categories and clients are no longer hard-coded here — they are loaded and reconciled from the
 * CSV files under {@code resources/seed/} by {@link FemmeDataInitializer}.
 */
public final class FemmeSalonCatalogBootstrapData {

  private FemmeSalonCatalogBootstrapData() {}

  public static final int DEFAULT_SERVICE_DURATION_MINUTES = 60;

  public static final List<ProfessionalRow> PROFESSIONALS =
      List.of(
          new ProfessionalRow("LUCIA ZYMANSCKI"),
          new ProfessionalRow("MIRYAM LEÓN"),
          new ProfessionalRow("ARACELY AGÜERO"),
          new ProfessionalRow("ANA MARIA CACERES"),
          new ProfessionalRow("MARTHA MARTINEZ CANTERO"),
          new ProfessionalRow("JORGELINA AGÜERO"),
          new ProfessionalRow("CONCEPCION VALDEZ"),
          new ProfessionalRow("LUCIA VALENZUELA"),
          new ProfessionalRow("ROSSANA MIGUELINA ENCISO"),
          new ProfessionalRow("NORMA LEIVA"),
          new ProfessionalRow("MONICA NOGUERA"));

  public record ProfessionalRow(String fullName) {}
}
