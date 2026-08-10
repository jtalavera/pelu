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
 * SIFEN HU-15: queries the final outcome of a batch previously submitted through {@link
 * SifenBatchReceptionClient} ({@code SiResultLoteDE}, Manual Técnico V150 sección 9.3), using the
 * tracking number ({@code dProtConsLote}) that submission's immediate acknowledgment returned.
 *
 * <p><b>Verified live (2026-07-28)</b>, same procedure as {@link SifenBatchReceptionClient}:
 * request root {@code rEnviConsLoteDe} ({@code dId} + {@code dProtConsLote}), response root {@code
 * rResEnviConsLoteDe} ({@code dFecProc}/{@code dCodResLot}/{@code dMsgResLot}/{@code
 * gResProcLote[0..50]}, each with {@code id} (CDC)/{@code dEstRes}/{@code dProtAut}/{@code
 * gResProc[1..5]}) — matches the manual's Schema XML 7/8 with no divergence found this time either
 * (a rarer case in this integration).
 *
 * <p><b>Batch-level result codes (Manual Técnico V150 Tabla F / sección 12.3.3.3), see {@link
 * SifenBatchQueryResult}</b>: {@code 0360} lote inexistente, {@code 0361} en procesamiento (poll
 * again), {@code 0362} procesamiento concluido ({@code gResProcLote} populated, one row per
 * document), {@code 0363} lote rechazado por contener tipos de DE distintos (the whole batch, no
 * individual results — relevant to HU-15 AC-05).
 */
@Service
public class SifenBatchResultQueryClient {

  private static final Logger log = LoggerFactory.getLogger(SifenBatchResultQueryClient.class);

  /** Confirmed live: the WSDL's own soap12:address, i.e. the WSDL path minus "?wsdl". */
  private static final String CONSULTA_LOTE_PATH = "/de/ws/consultas/consulta-lote.wsdl";

  private static final String OPERATION = "SiResultLoteDE";

  private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(30);

  private final SifenConnectionService connectionService;
  private final SifenConnectionProperties connectionProperties;

  public SifenBatchResultQueryClient(
      SifenConnectionService connectionService, SifenConnectionProperties connectionProperties) {
    this.connectionService = connectionService;
    this.connectionProperties = connectionProperties;
  }

  /** AC-01/AC-02/AC-03: queries {@code batchNumber}'s current status. */
  public Optional<SifenBatchQueryResult> query(long tenantId, String batchNumber) {
    return query(tenantId, batchNumber, null);
  }

  Optional<SifenBatchQueryResult> query(
      long tenantId, String batchNumber, javax.net.ssl.TrustManager[] testTrustManagers) {
    try {
      HttpClient client = connectionService.buildAuthenticatedClient(tenantId, testTrustManagers);
      return queryWithClient(client, batchNumber, "tenantId=" + tenantId);
    } catch (GeneralSecurityException e) {
      log.error("SIFEN batch query got no response tenantId={} error={}", tenantId, e.toString());
      return Optional.empty();
    }
  }

  /** EP-05 homologación (HU-15): same seam as {@link SifenBatchReceptionClient#sendWithClient}. */
  Optional<SifenBatchQueryResult> queryWithClient(
      HttpClient client, String batchNumber, String logContext) {
    String envelope = buildEnvelope(batchNumber);
    try {
      HttpRequest request =
          HttpRequest.newBuilder(
                  URI.create(connectionProperties.activeBaseUrl() + CONSULTA_LOTE_PATH))
              .timeout(REQUEST_TIMEOUT)
              .header("Content-Type", "application/soap+xml; charset=utf-8")
              .POST(HttpRequest.BodyPublishers.ofString(envelope, StandardCharsets.UTF_8))
              .build();
      log.info("[SIFEN req] operation={} {} batchNumber={}", OPERATION, logContext, batchNumber);
      HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());

      Optional<SifenBatchQueryResult> result = parseResponse(response.body());
      if (result.isEmpty()) {
        log.error(
            "SIFEN batch query response could not be parsed {} httpStatus={}",
            logContext,
            response.statusCode());
      } else {
        SifenBatchQueryResult r = result.get();
        log.info(
            "[SIFEN resp] operation={} {} code={} message={}",
            OPERATION,
            logContext,
            r.batchResultCode(),
            r.batchResultMessage());
      }
      return result;
    } catch (IOException | InterruptedException e) {
      if (Thread.currentThread().isInterrupted()) {
        Thread.currentThread().interrupt();
      }
      log.error("SIFEN batch query got no response {} error={}", logContext, e.toString());
      return Optional.empty();
    }
  }

  /** CSch01-03: {@code rEnviConsLoteDe/dId/dProtConsLote}, per sección 9.3.1. */
  private static String buildEnvelope(String batchNumber) {
    // Same rationale as SifenBatchReceptionClient's dId: sender-controlled correlation id, never
    // validated by SIFEN.
    long dId = System.currentTimeMillis();
    return "<soap:Envelope xmlns:soap=\"http://www.w3.org/2003/05/soap-envelope\">"
        + "<soap:Header/><soap:Body>"
        + "<rEnviConsLoteDe xmlns=\"http://ekuatia.set.gov.py/sifen/xsd\">"
        + "<dId>"
        + dId
        + "</dId>"
        + "<dProtConsLote>"
        + batchNumber
        + "</dProtConsLote>"
        + "</rEnviConsLoteDe></soap:Body></soap:Envelope>";
  }

  /** Same defensive-parsing philosophy as {@link SifenBatchReceptionClient#parseResponse}. */
  private static Optional<SifenBatchQueryResult> parseResponse(String body) {
    if (body == null || body.isBlank()) {
      return Optional.empty();
    }
    try {
      DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
      factory.setNamespaceAware(true);
      factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
      org.w3c.dom.Document doc =
          factory.newDocumentBuilder().parse(new InputSource(new StringReader(body)));
      Element root = doc.getDocumentElement();

      String batchResultCode = SifenXmlUtils.firstDescendantText(root, "dCodResLot");
      if (batchResultCode == null) {
        return Optional.empty();
      }
      String batchResultMessage = SifenXmlUtils.firstDescendantText(root, "dMsgResLot");

      List<SifenBatchDocumentResult> documents = new ArrayList<>();
      NodeList docNodes = root.getElementsByTagNameNS("*", "gResProcLote");
      for (int i = 0; i < docNodes.getLength(); i++) {
        Element gResProcLote = (Element) docNodes.item(i);
        String cdc = SifenXmlUtils.firstDescendantText(gResProcLote, "id");
        SifenSubmissionStatus status =
            mapStatus(SifenXmlUtils.firstDescendantText(gResProcLote, "dEstRes"));

        // "en caso de rechazo, será informado el motivo (solo el primer motivo de rechazo)" —
        // sección 9.3.2 — so this keeps only the first gResProc's code but joins every message,
        // same collection discipline as SifenDocumentReceptionClient.
        String resultCode = null;
        List<String> messages = new ArrayList<>();
        NodeList resProcNodes = gResProcLote.getElementsByTagNameNS("*", "gResProc");
        for (int j = 0; j < resProcNodes.getLength(); j++) {
          Element gResProc = (Element) resProcNodes.item(j);
          if (resultCode == null) {
            resultCode = SifenXmlUtils.firstDescendantText(gResProc, "dCodRes");
          }
          String message = SifenXmlUtils.firstDescendantText(gResProc, "dMsgRes");
          if (message != null && !message.isBlank()) {
            messages.add(message);
          }
        }
        documents.add(
            new SifenBatchDocumentResult(
                cdc, status, resultCode, messages.isEmpty() ? null : String.join("; ", messages)));
      }

      return Optional.of(
          new SifenBatchQueryResult(batchResultCode.trim(), batchResultMessage, documents));
    } catch (Exception e) {
      return Optional.empty();
    }
  }

  /** Same status literals as {@code SifenDocumentReceptionClient#mapStatus}. */
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
