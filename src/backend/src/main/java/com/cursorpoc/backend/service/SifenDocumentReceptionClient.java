package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.FemmeTimeProperties;
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
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import javax.xml.parsers.DocumentBuilderFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;

/**
 * SIFEN HU-06 AC-01: posts a signed document to SIFEN's synchronous reception service ({@code
 * rEnviDe}, Manual Técnico V150 sección 9.1) and parses whatever comes back, on the same mTLS
 * connection {@link SifenConnectionService} already knows how to build (HU-05).
 *
 * <p><b>Verified live (2026-07-28) against sifen-test.set.gov.py</b> with a real certificate and a
 * real signed document, which surfaced two deviations from what the manual documents:
 *
 * <ul>
 *   <li>The real endpoint to POST to is the WSDL address itself <b>without</b> the {@code ?wsdl}
 *       query string (confirmed from the live WSDL's own {@code soap12:address}), e.g. {@code
 *       https://sifen-test.set.gov.py/de/ws/sync/recibe.wsdl}.
 *   <li>HTTP status code does <b>not</b> reliably indicate acceptance vs. rejection: a malformed
 *       SOAP body came back as HTTP 400, but a well-formed body SIFEN rejected on schema grounds
 *       came back as HTTP 200 — both with a parseable {@code rRetEnviDe} body. So this always
 *       parses the response body regardless of status code, and only treats a transport failure or
 *       an unparseable body as "no response" (AC-05).
 *   <li>{@code dEstRes} came back as a <b>direct child of {@code rProtDe}</b> (a sibling of {@code
 *       gResProc}), not nested inside {@code gResProc} as both the manual's field table (sección
 *       9.1.3, PP050) and its own worked SOAP example (sección 7.4) show. {@code gResProc} can also
 *       repeat (observed: up to 4 in one response, one per validation error) — each with its own
 *       {@code dCodRes}/{@code dMsgRes}. Parsing here searches for these by local name anywhere
 *       under {@code rProtDe}/{@code gResProc} rather than assuming one fixed nesting, so it
 *       tolerates either shape.
 * </ul>
 *
 * Full "Aprobado" end to end could not be verified live during this story: SIFEN's schema requires
 * a {@code gCamFuFD/dCarQR} (QR code) group on every document, and computing that hash is HU-08's
 * job (it needs the CSC from "Configuración del ambiente de pruebas"), not HU-06's. The live checks
 * that were possible (malformed XML, schema-rejected XML) already exercise the exact response shape
 * this class parses.
 */
@Service
public class SifenDocumentReceptionClient {

  private static final Logger log = LoggerFactory.getLogger(SifenDocumentReceptionClient.class);

  /** Confirmed live: the WSDL's own soap12:address, i.e. the WSDL path minus "?wsdl". */
  private static final String SYNC_RECIBE_PATH = "/de/ws/sync/recibe.wsdl";

  private static final String OPERATION = "SiRecepDE";

  private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(30);

  private final SifenConnectionService connectionService;
  private final SifenConnectionProperties connectionProperties;
  private final FemmeTimeProperties timeProperties;

  public SifenDocumentReceptionClient(
      SifenConnectionService connectionService,
      SifenConnectionProperties connectionProperties,
      FemmeTimeProperties timeProperties) {
    this.connectionService = connectionService;
    this.connectionProperties = connectionProperties;
    this.timeProperties = timeProperties;
  }

  /**
   * AC-01: sends {@code signedDocumentXml} and waits for the response on the same connection.
   * AC-05: returns {@link Optional#empty()} — never throws for a transport-level failure — when no
   * response was received, so the caller can mark the invoice "pendiente de verificación" instead
   * of retrying automatically. A {@link org.springframework.web.server.ResponseStatusException}
   * from resolving the tenant's certificate (no valid certificate, RUC mismatch) is a configuration
   * error, not a communication failure, so it propagates instead of being swallowed here.
   */
  public Optional<SifenSubmissionResult> send(long tenantId, String signedDocumentXml) {
    return send(tenantId, signedDocumentXml, null);
  }

  Optional<SifenSubmissionResult> send(
      long tenantId, String signedDocumentXml, javax.net.ssl.TrustManager[] testTrustManagers) {
    try {
      HttpClient client = connectionService.buildAuthenticatedClient(tenantId, testTrustManagers);
      return sendWithClient(client, signedDocumentXml, "tenantId=" + tenantId);
    } catch (GeneralSecurityException e) {
      log.error("SIFEN submission got no response tenantId={} error={}", tenantId, e.toString());
      return Optional.empty();
    }
  }

  /**
   * EP-05 homologación (HU-13): package-visible overload that sends over an already-built mTLS
   * {@link HttpClient} instead of resolving one from a tenant's active certificate — lets a
   * homologation test send a real invoice signed with the pilot {@code .p12} directly, mirroring
   * the seam HU-12 opened on {@link SifenConnectionService#buildMutualTlsClient(KeyStore, String,
   * javax.net.ssl.TrustManager[])} for the same reason: a real homologation send isn't tied to any
   * tenant in this app. {@code logContext} is a free-text label (e.g. a CDC) for the log lines
   * only.
   */
  Optional<SifenSubmissionResult> sendWithClient(
      HttpClient client, String signedDocumentXml, String logContext) {
    long dId = System.currentTimeMillis();
    String envelope = buildEnvelope(signedDocumentXml, dId);
    try {
      HttpRequest request =
          HttpRequest.newBuilder(
                  URI.create(connectionProperties.activeBaseUrl() + SYNC_RECIBE_PATH))
              .timeout(REQUEST_TIMEOUT)
              .header("Content-Type", "application/soap+xml; charset=utf-8")
              .POST(HttpRequest.BodyPublishers.ofString(envelope, StandardCharsets.UTF_8))
              .build();
      log.info(
          "[SIFEN req] operation={} {} dId={} payloadChars={}",
          OPERATION,
          logContext,
          dId,
          signedDocumentXml.length());
      HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());

      Optional<SifenSubmissionResult> result =
          parseResponse(response.body(), LocalDateTime.now(timeProperties.zoneId()));
      if (result.isEmpty()) {
        log.error(
            "SIFEN submission response could not be parsed {} httpStatus={}",
            logContext,
            response.statusCode());
      } else {
        SifenSubmissionResult r = result.get();
        log.info(
            "[SIFEN resp] operation={} {} code={} message={}",
            OPERATION,
            logContext,
            r.resultCode(),
            r.message());
      }
      return result;
    } catch (IOException | InterruptedException e) {
      if (Thread.currentThread().isInterrupted()) {
        Thread.currentThread().interrupt();
      }
      log.error("SIFEN submission got no response {} error={}", logContext, e.toString());
      return Optional.empty();
    }
  }

  /**
   * ASch01-03: {@code rEnviDe/dId/xDE} wrapped in a SOAP 1.2 envelope, per sección 7.4/9.1.1.
   * ASch02/dId: a sequential id the sender is responsible for generating and controlling — SIFEN
   * doesn't validate its value, it's purely for the sender's own correlation. Millis-since-epoch
   * fits the field's 1-15 numeric digits and is always increasing within a single JVM run;
   * generated by the caller so it can also be logged alongside the request.
   */
  private static String buildEnvelope(String signedDocumentXml, long dId) {
    return "<soap:Envelope xmlns:soap=\"http://www.w3.org/2003/05/soap-envelope\">"
        + "<soap:Header/><soap:Body>"
        + "<rEnviDe xmlns=\"http://ekuatia.set.gov.py/sifen/xsd\">"
        + "<dId>"
        + dId
        + "</dId>"
        + "<xDE>"
        + signedDocumentXml
        + "</xDE>"
        + "</rEnviDe></soap:Body></soap:Envelope>";
  }

  /** See the class Javadoc for the real (manual-deviating) shape this parses. */
  private static Optional<SifenSubmissionResult> parseResponse(
      String body, LocalDateTime processedAt) {
    if (body == null || body.isBlank()) {
      return Optional.empty();
    }
    try {
      DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
      factory.setNamespaceAware(true);
      factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
      org.w3c.dom.Document doc =
          factory.newDocumentBuilder().parse(new InputSource(new StringReader(body)));

      Element rProtDe = SifenXmlUtils.firstDescendant(doc.getDocumentElement(), "rProtDe");
      if (rProtDe == null) {
        return Optional.empty();
      }
      SifenSubmissionStatus status =
          mapStatus(SifenXmlUtils.firstDescendantText(rProtDe, "dEstRes"));
      if (status == null) {
        return Optional.empty();
      }

      String protocolNumber = SifenXmlUtils.firstDescendantText(rProtDe, "dProtAut");
      String resultCode = null;
      List<String> messages = new ArrayList<>();
      NodeList resProcNodes = rProtDe.getElementsByTagNameNS("*", "gResProc");
      for (int i = 0; i < resProcNodes.getLength(); i++) {
        Element gResProc = (Element) resProcNodes.item(i);
        if (resultCode == null) {
          resultCode = SifenXmlUtils.firstDescendantText(gResProc, "dCodRes");
        }
        String message = SifenXmlUtils.firstDescendantText(gResProc, "dMsgRes");
        if (message != null && !message.isBlank()) {
          messages.add(message);
        }
      }

      return Optional.of(
          new SifenSubmissionResult(
              status,
              protocolNumber,
              resultCode,
              messages.isEmpty() ? null : String.join("; ", messages),
              processedAt));
    } catch (Exception e) {
      return Optional.empty();
    }
  }

  private static SifenSubmissionStatus mapStatus(String estado) {
    if (estado == null) {
      return null;
    }
    return switch (estado.trim()) {
      case "Aprobado" -> SifenSubmissionStatus.APPROVED;
      case "Aprobado con observación" -> SifenSubmissionStatus.APPROVED_WITH_OBSERVATION;
      case "Rechazado" -> SifenSubmissionStatus.REJECTED;
      default -> null;
    };
  }
}
