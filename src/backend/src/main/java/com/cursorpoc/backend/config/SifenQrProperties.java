package com.cursorpoc.backend.config;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * SIFEN HU-08: the QR code's public consultation URLs (per environment) and the CSC (Código de
 * Seguridad del Contribuyente) used to hash it — Manual Técnico V150 sección 13.8. Same
 * configuration-only environment switch pattern as {@link SifenConnectionProperties} (HU-05 AC-04):
 * the base URLs used for the QR image and the human-readable "consulta pública" link (HU-08
 * AC-10/AC-15) both depend on {@link SifenConnectionProperties#activeEnvironment()}.
 *
 * <p>Defaults are the two test CSCs the SET/DNIT published for the homologation environment (spec
 * "Configuración del ambiente de pruebas"); production requires its own CSC per tenant from the
 * DNIT — deliberately not modeled per-tenant yet (homologación real, activación por tenant, is
 * HU-22/Fase 5), same scope decision as {@code SifenConnectionProperties}' single environment flag
 * today.
 */
@ConfigurationProperties(prefix = "app.femme.sifen.qr")
public class SifenQrProperties {

  private String testQrBaseUrl = "https://ekuatia.set.gov.py/consultas-test/qr?";
  private String productionQrBaseUrl = "https://ekuatia.set.gov.py/consultas/qr?";
  private String testPublicConsultationUrl = "https://ekuatia.set.gov.py/consultas-test/";
  private String productionPublicConsultationUrl = "https://ekuatia.set.gov.py/consultas/";

  /** IdCSC actualmente activo — el manual permite hasta dos códigos activos simultáneamente. */
  private int activeCscId = 1;

  private Map<Integer, String> csc =
      new LinkedHashMap<>(
          Map.of(
              1, "ABCD0000000000000000000000000000",
              2, "EFGH0000000000000000000000000000"));

  public String getTestQrBaseUrl() {
    return testQrBaseUrl;
  }

  public void setTestQrBaseUrl(String testQrBaseUrl) {
    this.testQrBaseUrl = testQrBaseUrl;
  }

  public String getProductionQrBaseUrl() {
    return productionQrBaseUrl;
  }

  public void setProductionQrBaseUrl(String productionQrBaseUrl) {
    this.productionQrBaseUrl = productionQrBaseUrl;
  }

  public String getTestPublicConsultationUrl() {
    return testPublicConsultationUrl;
  }

  public void setTestPublicConsultationUrl(String testPublicConsultationUrl) {
    this.testPublicConsultationUrl = testPublicConsultationUrl;
  }

  public String getProductionPublicConsultationUrl() {
    return productionPublicConsultationUrl;
  }

  public void setProductionPublicConsultationUrl(String productionPublicConsultationUrl) {
    this.productionPublicConsultationUrl = productionPublicConsultationUrl;
  }

  public int getActiveCscId() {
    return activeCscId;
  }

  public void setActiveCscId(int activeCscId) {
    this.activeCscId = activeCscId;
  }

  public Map<Integer, String> getCsc() {
    return csc;
  }

  public void setCsc(Map<Integer, String> csc) {
    this.csc = csc;
  }

  /**
   * The active CSC's secret value, never logged/transmitted (Manual Técnico V150 sección 13.8.1).
   */
  public String activeCscSecret() {
    String secret = csc.get(activeCscId);
    if (secret == null) {
      throw new IllegalStateException("No CSC configured for activeCscId=" + activeCscId);
    }
    return secret;
  }
}
