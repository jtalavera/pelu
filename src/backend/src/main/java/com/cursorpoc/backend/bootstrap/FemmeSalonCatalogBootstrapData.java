package com.cursorpoc.backend.bootstrap;

import java.math.BigDecimal;
import java.util.List;

/**
 * Hard-coded salon catalog extracted from {@code Femme-Datos entrada.xlsx}. Prices use guaraníes
 * (integer amounts, two-decimal {@link BigDecimal} scale). Rows without a price in the spreadsheet
 * use {@link #DEFAULT_PRICE_MINOR}.
 */
public final class FemmeSalonCatalogBootstrapData {

  private FemmeSalonCatalogBootstrapData() {}

  public static final int DEFAULT_SERVICE_DURATION_MINUTES = 60;

  public static final BigDecimal DEFAULT_PRICE_MINOR = new BigDecimal("100000.00");

  /** Category creation order (matches first appearance in the Servicios sheet). */
  public static final List<String> CATEGORY_NAMES =
      List.of(
          "Lavado",
          "Corte",
          "Pelo",
          "Tintura",
          "Tratamientos corporales",
          "Productos",
          "Manos y Pies",
          "Maquillaje",
          "Tratamientos capilares");

  public static final List<ServiceRow> SERVICES =
      List.of(
          new ServiceRow("Lavado normal", "Lavado", new BigDecimal("40000.00")),
          new ServiceRow("Lavado Loreal", "Lavado", new BigDecimal("75000.00")),
          new ServiceRow("Lavado Kerastase", "Lavado", new BigDecimal("80000.00")),
          new ServiceRow("Lavado con otros productos", "Lavado", DEFAULT_PRICE_MINOR),
          new ServiceRow("B. de Crema", "Lavado", DEFAULT_PRICE_MINOR),
          new ServiceRow("Corte completo", "Corte", DEFAULT_PRICE_MINOR),
          new ServiceRow("Medio Corte", "Corte", DEFAULT_PRICE_MINOR),
          new ServiceRow("Brushing C/P", "Pelo", DEFAULT_PRICE_MINOR),
          new ServiceRow("Peinado", "Pelo", DEFAULT_PRICE_MINOR),
          new ServiceRow("Reboque P.", "Pelo", DEFAULT_PRICE_MINOR),
          new ServiceRow("Alisado", "Pelo", DEFAULT_PRICE_MINOR),
          new ServiceRow("Tintura pelo corto", "Tintura", new BigDecimal("250000.00")),
          new ServiceRow("Inoa", "Tintura", new BigDecimal("270000.00")),
          new ServiceRow("Tintura corona", "Tintura", new BigDecimal("180000.00")),
          new ServiceRow("Permanente", "Tintura", DEFAULT_PRICE_MINOR),
          new ServiceRow("Reflejos", "Tintura", DEFAULT_PRICE_MINOR),
          new ServiceRow("Flash", "Tintura", DEFAULT_PRICE_MINOR),
          new ServiceRow("Decoloración", "Tratamientos corporales", DEFAULT_PRICE_MINOR),
          new ServiceRow("Ampolla", "Productos", DEFAULT_PRICE_MINOR),
          new ServiceRow("Mousse", "Productos", DEFAULT_PRICE_MINOR),
          new ServiceRow("Manos", "Manos y Pies", DEFAULT_PRICE_MINOR),
          new ServiceRow("Pies", "Manos y Pies", DEFAULT_PRICE_MINOR),
          new ServiceRow("Uñas", "Manos y Pies", DEFAULT_PRICE_MINOR),
          new ServiceRow("Depilación", "Tratamientos corporales", DEFAULT_PRICE_MINOR),
          new ServiceRow("Maquillaje", "Maquillaje", DEFAULT_PRICE_MINOR),
          new ServiceRow("Mascara", "Tratamientos corporales", DEFAULT_PRICE_MINOR),
          new ServiceRow("Bar", "Productos", DEFAULT_PRICE_MINOR),
          new ServiceRow("Cosméticos", "Productos", DEFAULT_PRICE_MINOR),
          new ServiceRow("Loreal", "Tratamientos capilares", new BigDecimal("130000.00")),
          new ServiceRow("Kerastase", "Tratamientos capilares", new BigDecimal("150000.00")),
          new ServiceRow("Otros productos", "Tratamientos capilares", new BigDecimal("90000.00")),
          new ServiceRow("Baño de Brillo", "Tratamientos capilares", new BigDecimal("130000.00")));

  public static final List<ProfessionalRow> PROFESSIONALS =
      List.of(
          new ProfessionalRow("LUCIA ZYMANSCKI"),
          new ProfessionalRow("ISABEL ZYMANSCKI"),
          new ProfessionalRow("MIRYAM LEÓN"),
          new ProfessionalRow("ARACELY AGÜERO"),
          new ProfessionalRow("ANA MARIA CACERES"),
          new ProfessionalRow("MARTHA MARTINEZ CANTERO"),
          new ProfessionalRow("JORGELINA AGÜERO"),
          new ProfessionalRow("CONCEPCION VALDEZ"),
          new ProfessionalRow("MERCEDES AQUINO"),
          new ProfessionalRow("LUCIA VALENZUELA"),
          new ProfessionalRow("ROSSANA MIGUELINA ENCISO"),
          new ProfessionalRow("NORMA LEIVA"),
          new ProfessionalRow("MONICA NOGUERA"));

  public record ServiceRow(String name, String categoryName, BigDecimal priceMinor) {}

  public record ProfessionalRow(String fullName) {}
}
