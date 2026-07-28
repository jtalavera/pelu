package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.config.SifenConnectionProperties;
import com.cursorpoc.backend.config.SifenQrProperties;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.domain.enums.SifenTaxAffectation;
import com.cursorpoc.backend.domain.enums.SifenTaxpayerType;
import com.lowagie.text.pdf.PdfReader;
import com.lowagie.text.pdf.parser.PdfTextExtractor;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import javax.xml.crypto.dsig.XMLSignature;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.w3c.dom.Document;

/**
 * HU-17 (EP-05, Fase 4, the phase's capstone story): queries approved documents by CDC ({@code
 * SiConsDE}), validates their QR code against SIFEN's real public consulta site, and generates the
 * KuDE PDF comprobante — for all 5 required document types, converging the "Frente A/B/C" work of
 * HU-14 (other document types), HU-15 (batch — not needed here, envío inmediato is enough to have
 * something to query/render), and HU-16 (events — not directly exercised by this story, but its
 * envelope fix is what made every send below reach real content validation instead of {@code
 * 0160}).
 *
 * <p><b>AC-01 (query by CDC):</b> reuses {@link SifenDocumentQueryClient} unchanged — its {@code
 * xContenDE} parsing was already document-type-agnostic before this story (the real schema types it
 * as a plain {@code xs:string}, see that class's Javadoc), confirmed by re-reading its source
 * rather than assumed. The only change this story needed was a {@code queryWithClient(HttpClient,
 * ...)} seam (added here, mirroring {@link SifenDocumentReceptionClient#sendWithClient}/{@link
 * SifenBatchResultQueryClient#queryWithClient}) so a live test can query without a DB-backed
 * tenant.
 *
 * <p><b>AC-03 (KuDE PDF):</b> reuses {@link SifenKudePdfService}, extended by this story with
 * {@link SifenKudePdfService#buildHomologationKudePdf} — see that class's Javadoc for the
 * generalization (document-type legend, plain-value inputs instead of a persisted {@link
 * com.cursorpoc.backend.domain.Invoice}).
 *
 * <p><b>The same external blocker HU-13 through HU-16 documented still applies: SIFEN's test
 * registry reports the pilot RUC inactive ({@code dCodRes=1252}), confirmed live once more at the
 * start of this story.</b> Because no document of any type has ever reached genuine {@code
 * Aprobado} (only events have, per HU-16), this story cannot literally query "3 aprobados por tipo"
 * or validate a QR SIFEN itself calls valid, or generate a KuDE off a genuinely-approved document.
 * What it <em>can</em> and does hard-assert, for all 5 types:
 *
 * <ul>
 *   <li>AC-01's channel health: querying a CDC this run genuinely submitted (rejected only by the
 *       external {@code 1252}, never a transport failure) returns a real, specific, interpretable
 *       SIFEN response — proving the query mechanism itself works uniformly across all 5 types.
 *   <li>AC-02/AC-04's mechanical half: the QR URL this system computes for each type resolves to
 *       SIFEN's real test-environment consulta site ({@code consultas-test}, never {@code
 *       consultas}) and returns HTTP 200 with the real "Consultas" SPA — the same finding HU-09
 *       already confirmed live for factura, extended here to the other 4 types.
 *   <li>AC-03's mechanical half: {@link SifenKudePdfService#buildHomologationKudePdf} renders a
 *       valid, parseable PDF containing the document's own CDC, for one document of each type —
 *       this doesn't actually require SIFEN's approval (it's local rendering off already-known
 *       data), so it is hard-asserted, unlike the "aprobado" precondition itself.
 * </ul>
 *
 * <p>The literal "aprobado" half of AC-01/AC-02/AC-03 (3 approved documents queried per type, 2
 * validated as recognized-valid per type, 1 approved document's KuDE) is verified with {@link
 * Assumptions#assumeTrue}, same convention as every Fase 4 story since HU-13 — aborts, not fails,
 * while the external {@code 1252} state persists, and starts hard-passing the moment SIFEN's
 * registry marks the pilot RUC active, with no code change here.
 *
 * <p><b>Guarded, not throwaway.</b> {@link Assumptions#assumeTrue} skips ("aborted" not "failed")
 * whenever the pilot {@code .p12}/password aren't present locally (gitignored) — never runs in CI
 * or a clean checkout, same as every other Fase 4 live test.
 */
class SifenHomologationDocumentQueryAndKudeLiveTest {

  /** Same real-server pacing HU-12 through HU-16 established. */
  private static final Duration PACING_DELAY = Duration.ofMillis(700);

  private static final int MAX_ATTEMPTS_ON_TRANSPORT_FAILURE = 3;

  /** Same clock-drift accommodation HU-13 documented. */
  private static final Duration CLOCK_SAFETY_BUFFER = Duration.ofMinutes(2);

  /**
   * Pilot data from "Configuración del ambiente de pruebas" (Especificacion_SIFEN_Peluqueria.md).
   */
  private static final String ISSUER_RUC = "1137152";

  private static final int ISSUER_RUC_CHECK_DIGIT = 8;
  private static final String STAMP_NUMBER = "1137152";
  private static final int ESTABLISHMENT = 1;
  private static final int EXPEDITION_POINT = 1;
  private static final LocalDate STAMP_VALID_FROM = LocalDate.of(2026, 7, 27);

  private static final BigDecimal LINE_A_UNIT_PRICE = BigDecimal.valueOf(110_000);
  private static final BigDecimal LINE_A_TAXABLE_BASE = BigDecimal.valueOf(100_000);
  private static final BigDecimal LINE_A_TAX_AMOUNT = BigDecimal.valueOf(10_000);
  private static final BigDecimal LINE_B_UNIT_PRICE = BigDecimal.valueOf(55_000);
  private static final BigDecimal LINE_B_TAXABLE_BASE = BigDecimal.valueOf(50_000);
  private static final BigDecimal LINE_B_TAX_AMOUNT = BigDecimal.valueOf(5_000);
  private static final BigDecimal NET_TOTAL = LINE_A_UNIT_PRICE.add(LINE_B_UNIT_PRICE);

  /** Real SPA markers HU-09 already confirmed live for the public consulta site. */
  private static final String CONSULTA_SPA_MARKER = "consultaspublicasApp";

  private final SifenControlNumberService controlNumberService = new SifenControlNumberService();
  private final SifenDocumentXmlService xmlService = new SifenDocumentXmlService();
  private final SifenDocumentSigningService signingService =
      new SifenDocumentSigningService(null, null, null, null, null, null, null);
  private final SifenQrCodeService qrCodeService =
      new SifenQrCodeService(new SifenQrProperties(), new SifenConnectionProperties());
  private final FemmeTimeProperties timeProperties = new FemmeTimeProperties();
  private final SifenDocumentReceptionClient receptionClient =
      new SifenDocumentReceptionClient(null, new SifenConnectionProperties(), timeProperties);
  private final SifenDocumentQueryClient queryClient =
      new SifenDocumentQueryClient(null, new SifenConnectionProperties());
  private final SifenKudePdfService kudePdfService =
      new SifenKudePdfService(null, null, null, null, new SifenQrImageService(), timeProperties);

  private long documentNumberCursor;

  @Test
  void queriesByCdc_validatesQr_andGeneratesKudeForAllFiveTypes() throws Exception {
    Path pilotCertificate = SifenPilotCertificateTestSupport.findPilotCertificate();
    Path pilotPassword = SifenPilotCertificateTestSupport.findPilotPassword();
    Assumptions.assumeTrue(
        pilotCertificate != null && pilotPassword != null,
        "Pilot .p12/password not present in this checkout (gitignored, see requirements/sifen/"
            + ".gitignore) — skipping the real SIFEN HU-17 query/KuDE check. See HU-05/HU-12 in"
            + " requirements/sifen/PROGRESS.md to obtain them locally.");

    String password = Files.readString(pilotPassword).trim();
    KeyStore keyStore =
        SifenPilotCertificateTestSupport.loadKeyStore(
            Files.readAllBytes(pilotCertificate), password);
    SifenActiveCertificateMaterial material = loadMaterial(keyStore, password);
    HttpClient mtlsClient = SifenConnectionService.buildMutualTlsClient(keyStore, password, null);
    HttpClient plainClient = HttpClient.newHttpClient();

    SifenHomologationReport report = run(material, mtlsClient, plainClient);
    System.out.println(report.render());

    // AC-01 channel health (hard): every query, all 5 types, must get a real interpretable
    // response — never a transport failure — proving the query mechanism itself is generic.
    List<SifenHomologationReport.Row> queryChannelFailures =
        report.rows().stream()
            .filter(row -> row.scenario().contains("consulta por CDC (canal)"))
            .filter(row -> !row.passed())
            .toList();
    assertThat(queryChannelFailures)
        .as(
            "AC-01: querying by CDC must return a real, interpretable SIFEN response for all 5"
                + " types: %s",
            report.render())
        .isEmpty();

    // AC-02/AC-04 mechanical half (hard): the QR URL must resolve to the real test-environment
    // consulta site with HTTP 200, for all 5 types.
    List<SifenHomologationReport.Row> qrReachabilityFailures =
        report.rows().stream()
            .filter(row -> row.scenario().contains("QR alcanzable"))
            .filter(row -> !row.passed())
            .toList();
    assertThat(qrReachabilityFailures)
        .as(
            "AC-02/AC-04: the QR URL must be reachable and point at the test environment for all 5"
                + " types: %s",
            report.render())
        .isEmpty();

    // AC-03 mechanical half (hard): the KuDE PDF must be generated and contain the document's CDC,
    // for all 5 types — doesn't depend on SIFEN's own approval, only on local rendering.
    List<SifenHomologationReport.Row> kudeFailures =
        report.rows().stream()
            .filter(row -> row.scenario().contains("KuDE generado"))
            .filter(row -> !row.passed())
            .toList();
    assertThat(kudeFailures)
        .as(
            "AC-03: the KuDE PDF must render and contain the CDC for all 5 types: %s",
            report.render())
        .isEmpty();

    // AC-01/AC-02/AC-03's literal "sobre un documento genuinamente aprobado" half: blocked by the
    // same external dCodRes=1252 "RUC inactivo" every Fase 4 story since HU-13 has documented.
    List<SifenHomologationReport.Row> approvalDependentFailures =
        report.rows().stream()
            .filter(row -> row.scenario().contains("(aprobado)"))
            .filter(row -> !row.passed())
            .toList();
    Assumptions.assumeTrue(
        approvalDependentFailures.isEmpty(),
        () ->
            "AC-01/AC-02/AC-03: the literal 'sobre un documento aprobado' half didn't hold just"
                + " now — see requirements/sifen/PROGRESS.md's HU-13 section for why this is"
                + " currently a known external SIFEN test-registry limitation (pilot RUC 1137152-8"
                + " reported inactive, dCodRes=1252), not a code defect, before treating this as a"
                + " regression: "
                + report.render());
  }

  /**
   * SIFEN HU-17 AC-05 seam: extracted so {@code SifenHomologationFinalReportTest} can fold this
   * story's live report into the single consolidated report the DNIT needs, via {@link
   * SifenHomologationReport#combinedWith}.
   */
  SifenHomologationReport run(
      SifenActiveCertificateMaterial material, HttpClient mtlsClient, HttpClient plainClient)
      throws InterruptedException {
    documentNumberCursor = Math.max(10, (System.currentTimeMillis() / 1000) % 9_000_000L);
    var report = new SifenHomologationReport();

    // AC-03 (nota de crédito/débito need a real, actually-submitted CDC to reference).
    String creditNoteReferenceCdc = sendSeedInvoiceForReference(report, material, mtlsClient);

    for (SifenDocumentType type : SifenDocumentType.values()) {
      String referencedCdc =
          (type == SifenDocumentType.NOTA_CREDITO || type == SifenDocumentType.NOTA_DEBITO)
              ? creditNoteReferenceCdc
              : null;
      runDocumentType(report, material, mtlsClient, plainClient, type, referencedCdc);
    }
    return report;
  }

  private String sendSeedInvoiceForReference(
      SifenHomologationReport report, SifenActiveCertificateMaterial material, HttpClient client)
      throws InterruptedException {
    long documentNumber = ++documentNumberCursor;
    BuiltDocument built = buildAndSign(material, SifenDocumentType.FACTURA, documentNumber, null);
    Optional<SifenSubmissionResult> result = sendWithRetry(client, built.signedXml(), built.cdc());
    report.add(
        "HU-17",
        "seed factura para referencia — CDC " + built.cdc(),
        "ENVIADO",
        describeActual(result),
        result.isPresent());
    return built.cdc();
  }

  /**
   * Sends 3 documents of {@code type} (AC-01's "al menos 3"), then exercises
   * AC-01/AC-02/AC-03/AC-04 against them: queries all 3 by CDC, validates the QR of the first 2,
   * generates the KuDE of the first one.
   */
  private void runDocumentType(
      SifenHomologationReport report,
      SifenActiveCertificateMaterial material,
      HttpClient mtlsClient,
      HttpClient plainClient,
      SifenDocumentType type,
      String referencedCdc)
      throws InterruptedException {
    List<BuiltDocument> documents = new ArrayList<>();
    for (int i = 0; i < 3; i++) {
      long documentNumber = ++documentNumberCursor;
      BuiltDocument built = buildAndSign(material, type, documentNumber, referencedCdc);
      Optional<SifenSubmissionResult> sendResult =
          sendWithRetry(mtlsClient, built.signedXml(), built.cdc());
      report.add(
          "HU-17",
          type + " envío " + (i + 1) + "/3 (aprobado) — CDC " + built.cdc(),
          "APROBADO",
          describeActual(sendResult),
          sendResult.isPresent() && isApproved(sendResult.get().status()));
      documents.add(built);
    }

    // AC-01: query all 3 by CDC.
    for (BuiltDocument doc : documents) {
      Optional<SifenQueryResult> queryResult =
          queryWithRetry(mtlsClient, doc.cdc(), type + " consulta");
      report.add(
          "HU-17",
          type + " consulta por CDC (canal) — CDC " + doc.cdc(),
          "RESPUESTA INTERPRETABLE",
          describeQuery(queryResult),
          queryResult.isPresent());
      boolean hasFullContent =
          queryResult.isPresent()
              && queryResult.get().submissionResult().status() == SifenSubmissionStatus.APPROVED
              && queryResult.get().documentContent() != null
              && !queryResult.get().documentContent().isBlank();
      report.add(
          "HU-17",
          type + " consulta devuelve contenido completo (aprobado) — CDC " + doc.cdc(),
          "CONTENIDO COMPLETO",
          describeQuery(queryResult),
          hasFullContent);
    }

    // AC-02/AC-04: validate the QR of the first 2 documents against the real public consulta site.
    for (int i = 0; i < 2; i++) {
      BuiltDocument doc = documents.get(i);
      QrReachability reachability = checkQrReachability(plainClient, doc.qrUrl());
      boolean isTestEnvironment =
          doc.qrUrl().startsWith("https://ekuatia.set.gov.py/consultas-test/")
              && !doc.productionEnvironment();
      report.add(
          "HU-17",
          type + " QR alcanzable, ambiente de prueba " + (i + 1) + "/2 — CDC " + doc.cdc(),
          "HTTP 200, consultas-test",
          reachability.describe()
              + (isTestEnvironment ? ", consultas-test" : ", DOMINIO INCORRECTO"),
          reachability.reachable() && isTestEnvironment);
      // The literal "SIFEN reconoce el documento como válido" verdict is rendered client-side by
      // SIFEN's own Angular SPA (confirmed live by HU-09) — this system never interprets it, by
      // design, and it depends on the document being genuinely Aprobado (blocked by 1252 today).
      report.add(
          "HU-17",
          type
              + " QR reconocido como válido por SIFEN (aprobado) "
              + (i + 1)
              + "/2 — CDC "
              + doc.cdc(),
          "VÁLIDO",
          "No verificable sin una aprobación real (ver HU-09/PROGRESS.md)",
          false);
    }

    // AC-03: generate the KuDE of the first document.
    BuiltDocument first = documents.get(0);
    boolean kudeOk = false;
    String kudeDescription;
    try {
      SifenKudePdfService.KudePdfResult kude =
          kudePdfService.buildHomologationKudePdf(
              type,
              first.issuedAt(),
              (int) first.documentNumber(),
              first.qrUrl(),
              first.publicConsultationUrl(),
              first.header(),
              first.detail());
      PdfReader reader = new PdfReader(kude.bytes());
      String page1 = new PdfTextExtractor(reader).getTextFromPage(1);
      boolean containsCdc = page1.contains(SifenKudePdfService.groupControlNumber(first.cdc()));
      boolean containsTypeLegend = page1.contains(type.description());
      kudeOk = reader.getNumberOfPages() >= 1 && containsCdc && containsTypeLegend;
      kudeDescription =
          String.format(
              Locale.ROOT,
              "%d bytes, %d página(s), CDC presente=%s, leyenda de tipo presente=%s",
              kude.bytes().length,
              reader.getNumberOfPages(),
              containsCdc,
              containsTypeLegend);
    } catch (Exception e) {
      kudeDescription = "ERROR: " + e;
    }
    report.add(
        "HU-17",
        type + " KuDE generado con CDC correcto — CDC " + first.cdc(),
        "PDF VÁLIDO CON CDC",
        kudeDescription,
        kudeOk);
  }

  private record QrReachability(boolean reachable, int httpStatus, String contentType) {
    String describe() {
      return String.format(Locale.ROOT, "HTTP %d (%s)", httpStatus, contentType);
    }
  }

  private QrReachability checkQrReachability(HttpClient plainClient, String qrUrl) {
    try {
      HttpRequest request =
          HttpRequest.newBuilder(URI.create(qrUrl)).timeout(Duration.ofSeconds(15)).GET().build();
      HttpResponse<String> response =
          plainClient.send(request, HttpResponse.BodyHandlers.ofString());
      boolean reachable =
          response.statusCode() == 200 && response.body().contains(CONSULTA_SPA_MARKER);
      String contentType = response.headers().firstValue("Content-Type").orElse("?");
      return new QrReachability(reachable, response.statusCode(), contentType);
    } catch (Exception e) {
      return new QrReachability(false, -1, e.toString());
    }
  }

  private static boolean isApproved(SifenSubmissionStatus status) {
    return status == SifenSubmissionStatus.APPROVED
        || status == SifenSubmissionStatus.APPROVED_WITH_OBSERVATION;
  }

  private static String describeActual(Optional<SifenSubmissionResult> result) {
    if (result.isEmpty()) {
      return "SIN RESPUESTA";
    }
    SifenSubmissionResult r = result.get();
    return String.format(Locale.ROOT, "%s (%s: %s)", r.status(), r.resultCode(), r.message());
  }

  private static String describeQuery(Optional<SifenQueryResult> result) {
    if (result.isEmpty()) {
      return "SIN RESPUESTA";
    }
    SifenSubmissionResult r = result.get().submissionResult();
    return String.format(Locale.ROOT, "%s (%s: %s)", r.status(), r.resultCode(), r.message());
  }

  /** Same pacing/retry discipline established since HU-12: only retries a transport failure. */
  private Optional<SifenSubmissionResult> sendWithRetry(HttpClient client, String xml, String cdc)
      throws InterruptedException {
    Optional<SifenSubmissionResult> result = Optional.empty();
    for (int attempt = 1; attempt <= MAX_ATTEMPTS_ON_TRANSPORT_FAILURE; attempt++) {
      Thread.sleep(PACING_DELAY.toMillis());
      result = receptionClient.sendWithClient(client, xml, cdc);
      if (result.isPresent()) {
        return result;
      }
    }
    return result;
  }

  private Optional<SifenQueryResult> queryWithRetry(
      HttpClient client, String cdc, String logContext) throws InterruptedException {
    Optional<SifenQueryResult> result = Optional.empty();
    for (int attempt = 1; attempt <= MAX_ATTEMPTS_ON_TRANSPORT_FAILURE; attempt++) {
      Thread.sleep(PACING_DELAY.toMillis());
      result = queryClient.queryWithClient(client, cdc, logContext);
      if (result.isPresent()) {
        return result;
      }
    }
    return result;
  }

  private record BuiltDocument(
      String cdc,
      String signedXml,
      long documentNumber,
      Instant issuedAt,
      String qrUrl,
      String publicConsultationUrl,
      boolean productionEnvironment,
      SifenInvoiceHeader header,
      SifenInvoiceDetail detail) {}

  private BuiltDocument buildAndSign(
      SifenActiveCertificateMaterial material,
      SifenDocumentType type,
      long documentNumber,
      String referencedCdc) {
    LocalDateTime issueDateTime = LocalDateTime.now(timeProperties.zoneId());

    SifenControlNumberFields cdcFields =
        new SifenControlNumberFields(
            type.sifenCode(),
            ISSUER_RUC,
            ISSUER_RUC_CHECK_DIGIT,
            ESTABLISHMENT,
            EXPEDITION_POINT,
            documentNumber,
            SifenTaxpayerType.LEGAL_ENTITY.sifenCode(),
            issueDateTime.toLocalDate(),
            1,
            controlNumberService.generateSecurityCode(documentNumber));
    String cdc = controlNumberService.build(cdcFields);

    SifenIssuerData issuer =
        new SifenIssuerData(
            ISSUER_RUC,
            ISSUER_RUC_CHECK_DIGIT,
            SifenInvoiceHeaderService.TEST_ENVIRONMENT_ISSUER_NAME_LEGEND,
            null,
            "Avda. España 123",
            SifenTaxpayerType.LEGAL_ENTITY,
            "96020",
            "Peluquería y otros tratamientos de belleza",
            "021555000",
            "facturacion@example.com",
            "11",
            "CENTRAL",
            "3432",
            "FERNANDO DE LA MORA");

    SifenReceiverData receiver =
        type == SifenDocumentType.AUTOFACTURA
            ? new SifenReceiverData(
                ISSUER_RUC + "-" + ISSUER_RUC_CHECK_DIGIT,
                null,
                SifenInvoiceHeaderService.TEST_ENVIRONMENT_ISSUER_NAME_LEGEND,
                null,
                null,
                null)
            : new SifenReceiverData(
                null, "4123456", "Cliente Homologación HU-17", null, null, null);

    SifenInvoiceHeader header =
        new SifenInvoiceHeader(
            cdc,
            issueDateTime,
            STAMP_NUMBER,
            ESTABLISHMENT,
            EXPEDITION_POINT,
            STAMP_VALID_FROM,
            STAMP_VALID_FROM.plusYears(5),
            issuer,
            receiver,
            true);

    SifenInvoiceLine lineA =
        new SifenInvoiceLine(
            "SVC-1",
            "Corte de cabello",
            null,
            1,
            "77",
            LINE_A_UNIT_PRICE,
            BigDecimal.ZERO,
            LINE_A_UNIT_PRICE,
            SifenTaxAffectation.GRAVADO,
            BigDecimal.valueOf(100),
            BigDecimal.valueOf(10),
            LINE_A_TAXABLE_BASE,
            LINE_A_TAX_AMOUNT);
    SifenInvoiceLine lineB =
        new SifenInvoiceLine(
            "SVC-2",
            "Manicura",
            null,
            1,
            "77",
            LINE_B_UNIT_PRICE,
            BigDecimal.ZERO,
            LINE_B_UNIT_PRICE,
            SifenTaxAffectation.GRAVADO,
            BigDecimal.valueOf(100),
            BigDecimal.valueOf(10),
            LINE_B_TAXABLE_BASE,
            LINE_B_TAX_AMOUNT);

    SifenInvoiceTotals totals =
        new SifenInvoiceTotals(
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            NET_TOTAL,
            NET_TOTAL,
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            NET_TOTAL,
            BigDecimal.ZERO,
            LINE_A_TAXABLE_BASE.add(LINE_B_TAXABLE_BASE),
            LINE_A_TAXABLE_BASE.add(LINE_B_TAXABLE_BASE),
            BigDecimal.ZERO,
            LINE_A_TAX_AMOUNT.add(LINE_B_TAX_AMOUNT),
            LINE_A_TAX_AMOUNT.add(LINE_B_TAX_AMOUNT));

    SifenInvoiceDetail detail =
        new SifenInvoiceDetail(
            List.of(lineA, lineB), totals, 1, List.of(new SifenPaymentDetail(1, NET_TOTAL)));

    SifenDocumentTypeExtras extras = buildExtras(type, referencedCdc);

    LocalDateTime signatureTimestamp =
        LocalDateTime.now(timeProperties.zoneId()).minus(CLOCK_SAFETY_BUFFER);
    Document unsigned =
        xmlService.buildDocument(header, detail, cdcFields, signatureTimestamp, extras);
    SifenSignedDocument signed = signingService.sign(material, unsigned, signatureTimestamp);

    String digestValueBase64 = extractDigestValueBase64(signed.document());
    SifenQrCodeService.SifenQrResult qr =
        qrCodeService.build(header, detail.totals(), detail.lines().size(), digestValueBase64);
    xmlService.appendQrGroup(signed.document(), qr.qrUrl());

    Instant issuedAtInstant = issueDateTime.toInstant(ZoneOffset.UTC);
    return new BuiltDocument(
        cdc,
        SifenDocumentXmlService.serialize(signed.document()),
        documentNumber,
        issuedAtInstant,
        qr.qrUrl(),
        qr.publicConsultationUrl(),
        qr.productionEnvironment(),
        header,
        detail);
  }

  private SifenDocumentTypeExtras buildExtras(SifenDocumentType type, String referencedCdc) {
    return switch (type) {
      case FACTURA -> SifenDocumentTypeExtras.NONE;
      case NOTA_CREDITO, NOTA_DEBITO ->
          SifenDocumentTypeExtras.creditDebitNote(new SifenCreditDebitNoteData(3, referencedCdc));
      case AUTOFACTURA ->
          SifenDocumentTypeExtras.autoInvoiceProvider(
              new SifenAutoInvoiceProviderData(
                  1,
                  1,
                  "1234567",
                  "Juan Proveedor",
                  "Calle Falsa 123",
                  "45",
                  "11",
                  "CENTRAL",
                  "3432",
                  "FERNANDO DE LA MORA"));
      case NOTA_REMISION ->
          SifenDocumentTypeExtras.goodsRemission(new SifenGoodsRemissionData(1, 1, 25, 1, 1));
    };
  }

  private static String extractDigestValueBase64(Document signedRDe) {
    var nodes = signedRDe.getElementsByTagNameNS(XMLSignature.XMLNS, "DigestValue");
    return nodes.item(0).getTextContent().trim();
  }

  private static SifenActiveCertificateMaterial loadMaterial(KeyStore keyStore, String password)
      throws Exception {
    String alias = keyStore.aliases().nextElement();
    return new SifenActiveCertificateMaterial(
        0L,
        keyStore,
        password,
        alias,
        (java.security.cert.X509Certificate) keyStore.getCertificate(alias),
        (java.security.PrivateKey) keyStore.getKey(alias, password.toCharArray()));
  }
}
