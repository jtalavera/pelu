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
 * SIFEN HU-10/HU-11: posts a signed event (any event type — cancellation, nomination, ...) to
 * SIFEN's event registration service ({@code siRecepEvento}, {@code rEnviEventoDe}, Manual Técnico
 * V150 sección 9.5), on the same mTLS connection {@link SifenConnectionService} already knows how
 * to build (HU-05) — same pattern as {@link SifenDocumentReceptionClient} (HU-06) and {@link
 * SifenDocumentQueryClient} (HU-07), just against the events endpoint instead of
 * reception/consulta.
 *
 * <p><b>Originally {@code SifenCancellationEventClient} (HU-10) — renamed and generalized during
 * HU-11.</b> Nothing about sending/parsing an event envelope is specific to any one event type: the
 * request is always {@code rEnviEventoDe/dId/dEvReg/gGroupGesEve} wrapping whatever signed {@code
 * <rGesEve>} the caller built ({@link SifenCancellationEventXmlService} for HU-10, {@link
 * SifenClientIdentificationEventXmlService} for HU-11 — both produce the same {@code <rGesEve>}
 * shell, differing only in what {@code gGroupTiEvt} contains), and the response is always {@code
 * rRetEnviEventoDe/gResProcEVe}. HU-10's own class already had zero cancellation-specific code —
 * this rename just makes that explicit instead of leaving a generic client under a misleadingly
 * narrow name.
 *
 * <p><b>Verified live (2026-07-28) against sifen-test.set.gov.py</b> (WSDL + XSD fetched with the
 * same {@code curl --cert-type P12} pattern used by every prior SIFEN story in this integration):
 *
 * <ul>
 *   <li>Same deviation as HU-05/HU-06/HU-07: the manual doesn't publish the real endpoint at all
 *       for this service in its own quick-reference table; the live WSDL's {@code soap12:address}
 *       is {@code https://sifen-test.set.gov.py/de/ws/eventos/evento.wsdl} (i.e. the WSDL URL
 *       itself, without {@code ?wsdl}) — {@link #EVENTOS_PATH} is literally that.
 *   <li><b>Unlike HU-07's finding for {@code SiConsDE}</b>, this service's real XSD root element
 *       names match the manual exactly: request {@code rEnviEventoDe}, response {@code
 *       rRetEnviEventoDe} — confirmed from {@code evento.wsdl.xsd1.xsd}, not just the manual's own
 *       worked example (sección 7.2.2).
 *   <li>The response's result group is spelled {@code gResProcEVe} (capital "V", capital final "e")
 *       per the live XSD — a response can carry up to 15 of them (one cancellation attempt only
 *       ever produces one, but this parses generically in case a future event type in this
 *       integration batches several).
 * </ul>
 *
 * A genuinely SIFEN-approved cancellation (AC-03's happy path, HU-10) could not be verified live —
 * see {@code SifenInvoiceCancellationService}'s javadoc and PROGRESS.md for why (no document from
 * this system has ever reached real "Aprobado" status). What <b>was</b> verified live is the error
 * path: a syntactically valid event sent for a CDC that was never truly approved by SIFEN,
 * exercising this exact client/parsing code end to end against the real server — HU-11 hit the
 * exact same wall for the nomination event, see PROGRESS.md's HU-11 section.
 */
@Service
public class SifenEventClient {

  private static final Logger log = LoggerFactory.getLogger(SifenEventClient.class);

  /** Confirmed live: the WSDL's own soap12:address, i.e. the WSDL path minus "?wsdl". */
  private static final String EVENTOS_PATH = "/de/ws/eventos/evento.wsdl";

  private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(30);

  private final SifenConnectionService connectionService;
  private final SifenConnectionProperties connectionProperties;
  private final FemmeTimeProperties timeProperties;

  public SifenEventClient(
      SifenConnectionService connectionService,
      SifenConnectionProperties connectionProperties,
      FemmeTimeProperties timeProperties) {
    this.connectionService = connectionService;
    this.connectionProperties = connectionProperties;
    this.timeProperties = timeProperties;
  }

  /**
   * Sends {@code signedEventXml} (the serialized, signed {@code <rGesEve>} document {@link
   * SifenDocumentSigningService#signEvent} produced) and waits for the response on the same
   * connection. Returns {@link Optional#empty()} — never throws for a transport-level failure —
   * when no interpretable response was received, mirroring {@link
   * SifenDocumentReceptionClient#send} and {@link SifenDocumentQueryClient#query}'s contract.
   */
  public Optional<SifenSubmissionResult> send(long tenantId, String signedEventXml) {
    return send(tenantId, signedEventXml, null);
  }

  Optional<SifenSubmissionResult> send(
      long tenantId, String signedEventXml, javax.net.ssl.TrustManager[] testTrustManagers) {
    String envelope = buildEnvelope(signedEventXml);
    try {
      HttpClient client = connectionService.buildAuthenticatedClient(tenantId, testTrustManagers);
      HttpRequest request =
          HttpRequest.newBuilder(URI.create(connectionProperties.activeBaseUrl() + EVENTOS_PATH))
              .timeout(REQUEST_TIMEOUT)
              .header("Content-Type", "application/soap+xml; charset=utf-8")
              .POST(HttpRequest.BodyPublishers.ofString(envelope, StandardCharsets.UTF_8))
              .build();
      HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());

      Optional<SifenSubmissionResult> result =
          parseResponse(response.body(), LocalDateTime.now(timeProperties.zoneId()));
      if (result.isEmpty()) {
        log.error(
            "SIFEN cancellation event response could not be parsed tenantId={} httpStatus={}",
            tenantId,
            response.statusCode());
      }
      return result;
    } catch (IOException | InterruptedException | GeneralSecurityException e) {
      if (Thread.currentThread().isInterrupted()) {
        Thread.currentThread().interrupt();
      }
      log.error(
          "SIFEN cancellation event got no response tenantId={} error={}", tenantId, e.toString());
      return Optional.empty();
    }
  }

  /** {@code rEnviEventoDe/dId/dEvReg/gGroupGesEve}, per sección 9.5.1/11.5. */
  private static String buildEnvelope(String signedEventXml) {
    // Envelope-level dId (GSch02) allows up to 15 digits — same correlation-id rationale as
    // SifenDocumentReceptionClient/SifenDocumentQueryClient's own dId, unrelated to rEve's own
    // (much narrower) Id attribute.
    long dId = System.currentTimeMillis();
    return "<soap:Envelope xmlns:soap=\"http://www.w3.org/2003/05/soap-envelope\">"
        + "<soap:Header/><soap:Body>"
        + "<rEnviEventoDe xmlns=\"http://ekuatia.set.gov.py/sifen/xsd\">"
        + "<dId>"
        + dId
        + "</dId>"
        + "<dEvReg><gGroupGesEve>"
        + signedEventXml
        + "</gGroupGesEve></dEvReg>"
        + "</rEnviEventoDe></soap:Body></soap:Envelope>";
  }

  /** See the class Javadoc for the real (live-verified) shape this parses. */
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

      Element root = SifenXmlUtils.firstDescendant(doc.getDocumentElement(), "rRetEnviEventoDe");
      if (root == null) {
        // Either the malformed-request error shape shared with the reception/consulta services
        // (rRetEnviDe) or something unrecognized — no interpretable answer either way.
        return Optional.empty();
      }

      Element gResProcEVe = SifenXmlUtils.firstDescendant(root, "gResProcEVe");
      if (gResProcEVe == null) {
        return Optional.empty();
      }

      SifenSubmissionStatus status =
          mapStatus(SifenXmlUtils.firstDescendantText(gResProcEVe, "dEstRes"));
      if (status == null) {
        return Optional.empty();
      }

      String protocolNumber = SifenXmlUtils.firstDescendantText(gResProcEVe, "dProtAut");
      String resultCode = null;
      List<String> messages = new ArrayList<>();
      NodeList resProcNodes = gResProcEVe.getElementsByTagNameNS("*", "gResProc");
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

  /** Same three values as {@code dEstRes} on the reception service (sección 9.5.3, GRSch030). */
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
