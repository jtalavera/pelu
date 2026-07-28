package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.SifenConnectionProperties;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import java.io.IOException;
import java.io.StringReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.Optional;
import javax.xml.parsers.DocumentBuilderFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.w3c.dom.Element;
import org.xml.sax.InputSource;

/**
 * SIFEN HU-07: queries SIFEN's synchronous "consulta DE" service ({@code SiConsDE}, Manual Técnico
 * V150 sección 9.4) for the real status of a document by its CDC — for an invoice this system
 * marked 'pendiente de verificación' (HU-06 AC-05: no response was ever received for its submission
 * attempt), instead of blindly resending it.
 *
 * <p><b>Verified live (2026-07-28) against sifen-test.set.gov.py</b>, reusing the same mTLS
 * connection {@link SifenConnectionService} builds for HU-05/HU-06:
 *
 * <ul>
 *   <li>Same deviation as HU-05/HU-06: the manual (sección 7.10) only publishes the WSDL URL
 *       ({@code .../de/ws/consultas/consulta.wsdl?wsdl}); the real endpoint to POST to is that same
 *       URL <b>without</b> the {@code ?wsdl} query string, confirmed from the live WSDL's own
 *       {@code soap12:address}.
 *   <li>The request/response element names in the manual's own field tables (sección 9.4.1/9.4.3:
 *       {@code rEnviConsDe} / {@code rResEnviConsDe}) don't match the live XSD or the live
 *       response: the real root elements are {@code rEnviConsDeRequest} and {@code
 *       rEnviConsDeResponse} (confirmed both from {@code consulta.wsdl.xsd1.xsd} and from a real
 *       response body).
 *   <li>Querying a CDC that was never actually accepted by SIFEN (verified with a syntactically
 *       valid, well-formed CDC for the pilot RUC that was never successfully submitted) returned
 *       HTTP 200 with {@code dCodRes=0420}, message <i>"Documento No Existe en SIFEN o ha sido
 *       Rechazado"</i> — note this single message text already covers both halves of HU-07 AC-02's
 *       "No existe / Rechazado" wording, i.e. SIFEN itself doesn't distinguish "never received"
 *       from "received and rejected" in this response (sección 9.4.2's Tabla G documents 0420 as
 *       just "CDC inexistente", not this combined wording — another manual/live deviation).
 * </ul>
 *
 * <p>AC-01 (a genuinely Aprobado CDC, {@code dCodRes=0422}) and AC-03 (its full {@code xContenDE})
 * could not be verified live during this story: as documented in {@link
 * SifenDocumentReceptionClient}'s Javadoc (HU-06), no document sent by this system has reached real
 * SIFEN approval yet — {@code gCamFuFD/dCarQR} (the QR code hash) is missing from every document
 * this system builds, and computing it is HU-08's job. Because of that, the exact internal shape of
 * {@code xContenDE} for a found document (the manual's ContenedorDE schema documents a nested
 * {@code rDE}/{@code dProtAut}/{@code xContEv} structure, sección 9.4.3, but the live XSD types the
 * whole element as a plain {@code xs:string}, not structured XML — yet another manual/live-schema
 * mismatch, this time not resolvable without an actual approved response to inspect) is inferred
 * from the schema only, not observed live. This class stores whatever raw string SIFEN returns
 * there without attempting to parse a {@code dProtAut} out of it — see {@link SifenQueryResult}.
 */
@Service
public class SifenDocumentQueryClient {

  private static final Logger log = LoggerFactory.getLogger(SifenDocumentQueryClient.class);

  /** Confirmed live: the WSDL's own soap12:address, i.e. the WSDL path minus "?wsdl". */
  private static final String CONSULTA_PATH = "/de/ws/consultas/consulta.wsdl";

  private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(30);

  /** Sección 9.4.2, Tabla G: "RUC del certificado utilizado en la conexión no tiene permiso". */
  private static final String RESULT_CODE_RUC_NOT_AUTHORIZED = "0421";

  private final SifenConnectionService connectionService;
  private final SifenConnectionProperties connectionProperties;

  public SifenDocumentQueryClient(
      SifenConnectionService connectionService, SifenConnectionProperties connectionProperties) {
    this.connectionService = connectionService;
    this.connectionProperties = connectionProperties;
  }

  /**
   * AC-01/AC-02: queries {@code cdc}'s real status. Returns {@link Optional#empty()} — never throws
   * for a transport-level or unparseable-response failure — when SIFEN gives no interpretable
   * answer, so the caller leaves the invoice as 'pendiente de verificación' rather than guessing. A
   * {@link ResponseStatusException} from resolving the tenant's certificate (no valid certificate,
   * RUC mismatch), or a {@code SIFEN_QUERY_RUC_NOT_AUTHORIZED} for a querying certificate SIFEN
   * itself rejects (0421), is a configuration error, not a communication one, and propagates
   * instead of being swallowed here — same pattern as {@link SifenDocumentReceptionClient}.
   */
  public Optional<SifenQueryResult> query(long tenantId, String cdc) {
    return query(tenantId, cdc, null);
  }

  Optional<SifenQueryResult> query(
      long tenantId, String cdc, javax.net.ssl.TrustManager[] testTrustManagers) {
    try {
      HttpClient client = connectionService.buildAuthenticatedClient(tenantId, testTrustManagers);
      return queryWithClient(client, cdc, "tenantId=" + tenantId);
    } catch (GeneralSecurityException e) {
      log.error("SIFEN status query got no response tenantId={} error={}", tenantId, e.toString());
      return Optional.empty();
    }
  }

  /**
   * EP-05 homologación (HU-17): same seam {@link SifenDocumentReceptionClient#sendWithClient}/
   * {@link SifenBatchResultQueryClient#queryWithClient} already opened — sends over an
   * already-built mTLS {@link HttpClient} (the pilot certificate for a live homologation test, not
   * a DB-backed tenant certificate), so this query can be exercised standalone against any CDC,
   * document type included, since {@code xContenDE} itself is document-type-agnostic (see class
   * Javadoc — it's typed as a plain {@code xs:string} by the real schema, never parsed further
   * here).
   */
  Optional<SifenQueryResult> queryWithClient(HttpClient client, String cdc, String logContext) {
    String envelope = buildEnvelope(cdc);
    try {
      HttpRequest request =
          HttpRequest.newBuilder(URI.create(connectionProperties.activeBaseUrl() + CONSULTA_PATH))
              .timeout(REQUEST_TIMEOUT)
              .header("Content-Type", "application/soap+xml; charset=utf-8")
              .POST(HttpRequest.BodyPublishers.ofString(envelope, StandardCharsets.UTF_8))
              .build();
      HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());

      return handleResponse(logContext, cdc, response.body(), response.statusCode());
    } catch (IOException | InterruptedException e) {
      if (Thread.currentThread().isInterrupted()) {
        Thread.currentThread().interrupt();
      }
      log.error("SIFEN status query got no response {} error={}", logContext, e.toString());
      return Optional.empty();
    }
  }

  private Optional<SifenQueryResult> handleResponse(
      String logContext, String cdc, String body, int httpStatus) {
    ParsedQueryResponse parsed = parseResponse(body);
    if (parsed == null) {
      log.error(
          "SIFEN status query response could not be parsed {} httpStatus={}",
          logContext,
          httpStatus);
      return Optional.empty();
    }
    if (RESULT_CODE_RUC_NOT_AUTHORIZED.equals(parsed.resultCode())) {
      log.error(
          "SIFEN status query rejected: querying certificate's RUC has no permission {} cdc={}",
          logContext,
          cdc);
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "SIFEN_QUERY_RUC_NOT_AUTHORIZED");
    }
    SifenSubmissionStatus status = mapStatus(parsed.resultCode());
    if (status == null) {
      log.error(
          "SIFEN status query returned an unrecognized result code {} resultCode={}",
          logContext,
          parsed.resultCode());
      return Optional.empty();
    }
    LocalDateTime processedAt = LocalDateTime.now();
    return Optional.of(
        new SifenQueryResult(
            new SifenSubmissionResult(
                status, null, parsed.resultCode(), parsed.message(), processedAt),
            parsed.documentContent()));
  }

  /** ASch: {@code rEnviConsDeRequest/dId/dCDC}, per sección 9.4.1. */
  private static String buildEnvelope(String cdc) {
    // Same rationale as SifenDocumentReceptionClient's dId: sender-controlled correlation id,
    // never validated by SIFEN.
    long dId = System.currentTimeMillis();
    return "<soap:Envelope xmlns:soap=\"http://www.w3.org/2003/05/soap-envelope\">"
        + "<soap:Header/><soap:Body>"
        + "<rEnviConsDeRequest xmlns=\"http://ekuatia.set.gov.py/sifen/xsd\">"
        + "<dId>"
        + dId
        + "</dId>"
        + "<dCDC>"
        + cdc
        + "</dCDC>"
        + "</rEnviConsDeRequest></soap:Body></soap:Envelope>";
  }

  private record ParsedQueryResponse(String resultCode, String message, String documentContent) {}

  /** See the class Javadoc for the real (manual-deviating) shape this parses. */
  private static ParsedQueryResponse parseResponse(String body) {
    if (body == null || body.isBlank()) {
      return null;
    }
    try {
      DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
      factory.setNamespaceAware(true);
      factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
      org.w3c.dom.Document doc =
          factory.newDocumentBuilder().parse(new InputSource(new StringReader(body)));

      Element consResponse =
          SifenXmlUtils.firstDescendant(doc.getDocumentElement(), "rEnviConsDeResponse");
      if (consResponse == null) {
        // Either an unrelated error shape (e.g. the malformed-request rRetEnviDe the reception
        // service also uses) or something unrecognized — no interpretable answer either way.
        return null;
      }

      String resultCode = SifenXmlUtils.firstDescendantText(consResponse, "dCodRes");
      if (resultCode == null) {
        return null;
      }
      String message = SifenXmlUtils.firstDescendantText(consResponse, "dMsgRes");
      String documentContent = SifenXmlUtils.firstDescendantText(consResponse, "xContenDE");
      return new ParsedQueryResponse(resultCode, message, documentContent);
    } catch (Exception e) {
      return null;
    }
  }

  /**
   * Sección 9.4.2 (Tabla G): 0422 "CDC encontrado" means the document exists and was processed —
   * mapped to {@link SifenSubmissionStatus#APPROVED} (AC-01). SIFEN folds "no existe" and
   * "rechazado" into the same 0420 answer (see class Javadoc), so both map onto the single terminal
   * outcome HU-07 AC-02 asks for ("No existe / Rechazado") by reusing {@link
   * SifenSubmissionStatus#REJECTED} rather than adding a new enum value — no further distinction is
   * possible from this response alone. 0421 isn't mapped here at all; see {@link #handleResponse}.
   */
  private static SifenSubmissionStatus mapStatus(String codRes) {
    if (codRes == null) {
      return null;
    }
    return switch (codRes.trim()) {
      case "0422" -> SifenSubmissionStatus.APPROVED;
      case "0420" -> SifenSubmissionStatus.REJECTED;
      default -> null;
    };
  }
}
