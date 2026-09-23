package com.cursorpoc.backend.service;

/**
 * HU-12 (EP-05, homologación ante la DNIT): the 7 services AC-01 names by name, each mapped to the
 * real WSDL path it resolves to. Same investigation method as HU-05/06/07/10/11 (fetching the WSDL
 * live with {@code curl --cert-type P12} against the real {@code sifen-test.set.gov.py}, following
 * section 7.10 of the technical manual's "Resumen de las Direcciones Electrónicas..." table):
 *
 * <ul>
 *   <li>{@link #IMMEDIATE_RECEPTION}, {@link #INVOICE_QUERY} (as {@code SiConsDE}) and {@link
 *       #EVENT_REGISTRATION} are the 3 services already verified live and in production use since
 *       HU-05/06/07/10/11 — see {@code SifenDocumentReceptionClient}, {@code
 *       SifenDocumentQueryClient} and {@code SifenEventClient}.
 *   <li>{@link #BATCH_RECEPTION} ({@code /de/ws/async/recibe-lote.wsdl?wsdl}), {@link
 *       #BATCH_RESULT_QUERY} ({@code /de/ws/consultas/consulta-lote.wsdl?wsdl}) and {@link
 *       #RUC_QUERY} ({@code /de/ws/consultas/consulta-ruc.wsdl?wsdl}) are new for HU-12 — verified
 *       live the same way (2026-07-28): all 3 return HTTP 200 with a real WSDL body for the exact
 *       path the manual publishes (no errata this time, unlike HU-05's {@code recibe.wsd} typo),
 *       and each WSDL's own {@code soap12:address} confirms the real POST endpoint is that same URL
 *       minus the {@code ?wsdl} query string — same pattern HU-05/06/07/10 already established.
 *   <li><b>{@link #DOCUMENT_QUERY} is deliberately the same path as {@link #INVOICE_QUERY}.</b>
 *       AC-01 names "consulta de facturas" and "consulta de documentos" as two separate items, but
 *       section 8 of the manual (list of synchronous/asynchronous services SIFEN offers) only ever
 *       names one synchronous query service, {@code Consulta DE} ({@code SiConsDE}) — there is no
 *       second, distinct "document query" WSDL in the test environment's endpoint table. Rather
 *       than inventing a connectivity target SIFEN doesn't expose, both AC-01 line items are
 *       checked against the one real endpoint that exists — honestly documented here instead of
 *       silently dropping one of the two named checks.
 * </ul>
 */
public enum SifenHomologationEndpoint {
  IMMEDIATE_RECEPTION("Envío inmediato (SiRecepDE)", "/de/ws/sync/recibe.wsdl?wsdl"),
  BATCH_RECEPTION("Envío por lotes (SiRecepLoteDE)", "/de/ws/async/recibe-lote.wsdl?wsdl"),
  INVOICE_QUERY("Consulta de facturas (SiConsDE)", "/de/ws/consultas/consulta.wsdl?wsdl"),
  BATCH_RESULT_QUERY(
      "Consulta de resultado de lotes (SiResultLoteDE)",
      "/de/ws/consultas/consulta-lote.wsdl?wsdl"),
  DOCUMENT_QUERY("Consulta de documentos (SiConsDE)", "/de/ws/consultas/consulta.wsdl?wsdl"),
  EVENT_REGISTRATION("Registro de eventos (SiRecepEvento)", "/de/ws/eventos/evento.wsdl?wsdl"),
  RUC_QUERY("Consulta de contribuyentes (SiConsRUC)", "/de/ws/consultas/consulta-ruc.wsdl?wsdl");

  private final String displayName;
  private final String wsdlPath;

  SifenHomologationEndpoint(String displayName, String wsdlPath) {
    this.displayName = displayName;
    this.wsdlPath = wsdlPath;
  }

  public String displayName() {
    return displayName;
  }

  /** Includes the {@code ?wsdl} query string — this is the GET target for a connectivity check. */
  public String wsdlPath() {
    return wsdlPath;
  }
}
