package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.SifenConnectionProperties;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.StringReader;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import javax.xml.parsers.DocumentBuilderFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.w3c.dom.Element;
import org.xml.sax.InputSource;

/**
 * SIFEN HU-15 (EP-05, Fase 4, "Frente B"): posts a batch of up to 50 already-signed documents to
 * SIFEN's asynchronous batch reception service ({@code SiRecepLoteDE}, Manual Técnico V150 sección
 * 9.2) — a web service this integration never used until this story, since every prior HU (HU-06
 * onward) only ever used the synchronous {@code SiRecepDE} ({@link SifenDocumentReceptionClient}).
 *
 * <p><b>Verified live (2026-07-28) against sifen-test.set.gov.py</b>: fetched the real WSDL/XSD
 * with the pilot {@code .p12} ({@code curl --cert-type P12
 * .../de/ws/async/recibe-lote.wsdl(.xsd1.xsd)}), confirming the request/response element names
 * match the manual almost exactly — unusually, since most prior HUs in this integration found some
 * manual/live divergence at this exact step:
 *
 * <ul>
 *   <li>Request root is {@code rEnvioLote} ({@code dId} + {@code xDE}, the latter {@code
 *       xs:base64Binary} with {@code expectedContentTypes="application/zip"}) — matches Schema XML
 *       5 exactly.
 *   <li>Response root is {@code rResEnviLoteDe} ({@code dFecProc}/{@code dCodRes}/{@code
 *       dMsgRes}/{@code dProtConsLote}/{@code dTpoProces}, all {@code minOccurs="0"} in the live
 *       XSD) — matches Schema XML 6.
 *   <li>The real endpoint to POST to is the WSDL's own {@code soap12:address}, i.e. the WSDL path
 *       without the {@code ?wsdl} query string — the same pattern every prior service in this
 *       integration has already confirmed.
 * </ul>
 *
 * <p><b>{@code xDE}'s content</b> (Schema XML 5A, {@code ProtProcesLoteDE_v150.xsd}): a {@code
 * rLoteDE} root wrapping 1-50 {@code rDE} children ("Sigue las definiciones del Capítulo Formato de
 * los DE") — exactly the serialized {@code <rDE>...</rDE>} strings {@link SifenDocumentXmlService}/
 * {@link SifenDocumentSigningService} already produce for envío inmediato, concatenated inside one
 * {@code rLoteDE} wrapper, then zip-compressed and Base64-encoded — see {@link
 * #buildCompressedLotePayload}.
 *
 * <p><b>{@code dTpoProces} ("Tiempo medio de procesamiento en segundos") is this integration's
 * answer to HU-15 AC-01's "tiempo mínimo recomendado antes de consultar".</b> The manual never
 * publishes a fixed wait-time constant anywhere else (checked secciones 9.2/9.3/12.3.2/12.3.3 in
 * full — no number appears), and the public {@code TIPS-SA/facturacionelectronicapy-setapi} SDK
 * (the same SDK family cross-checked by HU-08/10/11/14) leaves polling entirely up to the caller
 * with no fixed interval either. But the immediate acknowledgment response itself carries a
 * per-batch, SIFEN-computed estimate — a strictly better "recommended minimum wait" than any
 * hardcoded guess, since it's real-time and specific to this batch's own size/load. The guarded
 * live test waits at least this many seconds (with a small floor for when SIFEN returns 0 in the
 * test environment) before its first query attempt.
 *
 * <p><b>A lote is single-type and single-emisor by design (sección 9.2.2: "Un lote debe contener
 * solo un mismo tipo de DE", and the whole batch is authenticated by one client certificate, i.e.
 * one emisor).</b> This class doesn't enforce either rule itself — the caller decides what goes
 * into {@code signedDocumentXmls} — the guarded live test verifies what SIFEN itself does when
 * those rules are violated anyway (HU-15 AC-04/AC-05).
 */
@Service
public class SifenBatchReceptionClient {

  private static final Logger log = LoggerFactory.getLogger(SifenBatchReceptionClient.class);

  /** Confirmed live: the WSDL's own soap12:address, i.e. the WSDL path minus "?wsdl". */
  private static final String ASYNC_RECIBE_LOTE_PATH = "/de/ws/async/recibe-lote.wsdl";

  /**
   * A batch can carry up to 50 documents (up to 10.000 KB) — allow more time than a single send.
   */
  private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(60);

  private static final String ZIP_ENTRY_NAME = "lote.xml";

  private final SifenConnectionService connectionService;
  private final SifenConnectionProperties connectionProperties;

  public SifenBatchReceptionClient(
      SifenConnectionService connectionService, SifenConnectionProperties connectionProperties) {
    this.connectionService = connectionService;
    this.connectionProperties = connectionProperties;
  }

  /** AC-01/AC-02: sends a batch (1-50 signed {@code <rDE>} documents) and awaits the ack. */
  public Optional<SifenBatchSubmissionResult> send(long tenantId, List<String> signedDocumentXmls) {
    return send(tenantId, signedDocumentXmls, null);
  }

  Optional<SifenBatchSubmissionResult> send(
      long tenantId,
      List<String> signedDocumentXmls,
      javax.net.ssl.TrustManager[] testTrustManagers) {
    try {
      HttpClient client = connectionService.buildAuthenticatedClient(tenantId, testTrustManagers);
      return sendWithClient(client, signedDocumentXmls, "tenantId=" + tenantId);
    } catch (GeneralSecurityException e) {
      log.error(
          "SIFEN batch submission got no response tenantId={} error={}", tenantId, e.toString());
      return Optional.empty();
    }
  }

  /**
   * EP-05 homologación (HU-15): same seam HU-12/HU-13 opened on {@link
   * SifenDocumentReceptionClient#sendWithClient} — sends over an already-built mTLS {@link
   * HttpClient} instead of resolving one from a tenant's active certificate, since a real
   * homologation batch isn't tied to any tenant in this app.
   */
  Optional<SifenBatchSubmissionResult> sendWithClient(
      HttpClient client, List<String> signedDocumentXmls, String logContext) {
    String envelope;
    try {
      envelope = buildEnvelope(signedDocumentXmls);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
    try {
      HttpRequest request =
          HttpRequest.newBuilder(
                  URI.create(connectionProperties.activeBaseUrl() + ASYNC_RECIBE_LOTE_PATH))
              .timeout(REQUEST_TIMEOUT)
              .header("Content-Type", "application/soap+xml; charset=utf-8")
              .POST(HttpRequest.BodyPublishers.ofString(envelope, StandardCharsets.UTF_8))
              .build();
      HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());

      Optional<SifenBatchSubmissionResult> result = parseResponse(response.body());
      if (result.isEmpty()) {
        log.error(
            "SIFEN batch submission response could not be parsed {} httpStatus={}",
            logContext,
            response.statusCode());
      }
      return result;
    } catch (IOException | InterruptedException e) {
      if (Thread.currentThread().isInterrupted()) {
        Thread.currentThread().interrupt();
      }
      log.error("SIFEN batch submission got no response {} error={}", logContext, e.toString());
      return Optional.empty();
    }
  }

  /** BSch01-03: {@code rEnvioLote/dId/xDE} wrapped in a SOAP 1.2 envelope, per sección 9.2.1. */
  private static String buildEnvelope(List<String> signedDocumentXmls) throws IOException {
    // Same rationale as SifenDocumentReceptionClient's dId: sender-controlled correlation id,
    // never validated by SIFEN.
    long dId = System.currentTimeMillis();
    String base64Zip = buildCompressedLotePayload(signedDocumentXmls);
    return "<soap:Envelope xmlns:soap=\"http://www.w3.org/2003/05/soap-envelope\">"
        + "<soap:Header/><soap:Body>"
        + "<rEnvioLote xmlns=\"http://ekuatia.set.gov.py/sifen/xsd\">"
        + "<dId>"
        + dId
        + "</dId>"
        + "<xDE>"
        + base64Zip
        + "</xDE>"
        + "</rEnvioLote></soap:Body></soap:Envelope>";
  }

  /**
   * Schema XML 5A ({@code ProtProcesLoteDE_v150.xsd}): a {@code rLoteDE} root wrapping the 1-50
   * {@code rDE} documents (already-serialized, signed XML), zip-compressed and then Base64-encoded
   * — exactly what {@code xDE} (BSch03) expects. Package-visible for direct unit testing without a
   * live server.
   */
  static String buildCompressedLotePayload(List<String> signedDocumentXmls) throws IOException {
    String rLoteDe =
        "<rLoteDE xmlns=\"http://ekuatia.set.gov.py/sifen/xsd\">"
            + String.join("", signedDocumentXmls)
            + "</rLoteDE>";
    ByteArrayOutputStream baos = new ByteArrayOutputStream();
    try (ZipOutputStream zos = new ZipOutputStream(baos)) {
      zos.putNextEntry(new ZipEntry(ZIP_ENTRY_NAME));
      zos.write(rLoteDe.getBytes(StandardCharsets.UTF_8));
      zos.closeEntry();
    }
    return Base64.getEncoder().encodeToString(baos.toByteArray());
  }

  /**
   * Same defensive parsing philosophy {@link SifenDocumentReceptionClient} established (its class
   * Javadoc, HU-06): searches for each field by local name anywhere under the envelope rather than
   * assuming one fixed nesting depth, since this response shape is new territory for this
   * integration, not yet stress-tested against every possible real variation.
   */
  private static Optional<SifenBatchSubmissionResult> parseResponse(String body) {
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

      String resultCode = SifenXmlUtils.firstDescendantText(root, "dCodRes");
      if (resultCode == null) {
        return Optional.empty();
      }
      String message = SifenXmlUtils.firstDescendantText(root, "dMsgRes");
      String batchNumber = SifenXmlUtils.firstDescendantText(root, "dProtConsLote");
      String recommendedWaitRaw = SifenXmlUtils.firstDescendantText(root, "dTpoProces");
      Integer recommendedWait =
          recommendedWaitRaw == null ? null : Integer.valueOf(recommendedWaitRaw.trim());

      // Sección 12.3.2.3: BF01 dCodRes=0300 "Lote recibido con éxito" (A) vs. BF02 dCodRes=0301
      // "Lote no encolado para procesamiento" (R) — 0300 is the only accepted code.
      boolean accepted = "0300".equals(resultCode.trim());
      return Optional.of(
          new SifenBatchSubmissionResult(
              accepted, resultCode.trim(), message, batchNumber, recommendedWait));
    } catch (Exception e) {
      return Optional.empty();
    }
  }
}
