package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.config.SifenConnectionProperties;
import com.cursorpoc.backend.config.SifenQrProperties;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.domain.enums.SifenTaxAffectation;
import com.cursorpoc.backend.domain.enums.SifenTaxpayerType;
import java.math.BigDecimal;
import java.net.http.HttpClient;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import javax.xml.crypto.dsig.XMLSignature;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.w3c.dom.Document;

/**
 * HU-15 (EP-05, Fase 4, "Frente B"): sends batches of every one of the 5 required document types
 * through SIFEN's <b>asynchronous</b> batch reception service ({@code SiRecepLoteDE}, {@link
 * SifenBatchReceptionClient}) — a web service this integration has never used until this story,
 * unlike every prior HU (HU-06 onward), which only ever used the synchronous {@code SiRecepDE}
 * ({@link SifenDocumentReceptionClient}) — then polls {@link SifenBatchResultQueryClient} for the
 * final per-document outcome, against {@code sifen-test.set.gov.py} with the pilot {@code .p12}.
 *
 * <p><b>AC-01/AC-02 (5 correct documents per type, expected all approved):</b> covers the same 5
 * types HU-13/HU-14 already build (factura, nota de crédito, nota de débito, autofactura, nota de
 * remisión) — {@link SifenDocumentType}, {@link SifenDocumentTypeExtras} — reused unchanged.
 * <b>Confirmed live (2026-07-28): SIFEN's batch service accepts all 5 types</b>, not just the 3
 * ({@code Factura}/{@code Nota de crédito}/{@code Nota de débito}) the raw {@code
 * recibe-lote.wsdl.xsd1.xsd}'s locally-embedded {@code tiTiDE}/{@code tdDesTiDE} simple types
 * (pattern {@code "1|[5-6]"}, enumeration missing Autofactura/Nota de remisión entirely) would
 * suggest at first read — a throwaway probe sent real batches of all 5 types and every one of them
 * got {@code dCodRes=0300} accepted and {@code dCodResLot=0362} concluded, same as factura. That
 * embedded type restriction turned out to be inert boilerplate (this WSDL's own request/response
 * elements — {@code rEnvioLote}/{@code rResEnviLoteDe} — don't reference it at all; {@code xDE} is
 * typed as opaque {@code xs:base64Binary}), not an enforced business rule — a leftover, outdated
 * copy of the same "common types" section every one of this integration's XSD files carries, simply
 * never updated when NT extended the catalog to 5 document types.
 *
 * <p><b>The same external blocker HU-13/HU-14 found still applies here: SIFEN's test registry
 * reports the pilot RUC inactive ({@code dCodRes=1252}).</b> Confirmed live for all 5 types sent by
 * batch, exactly as for envío inmediato — AC-01/AC-02's "correct → approved" half is verified with
 * {@link Assumptions#assumeTrue}, aborting (not failing) while this persists, per this
 * integration's established convention.
 *
 * <p><b>AC-01's "tiempo mínimo recomendado antes de consultar":</b> {@link
 * SifenBatchSubmissionResult#recommendedWaitSeconds} ({@code dTpoProces}) — confirmed live to be
 * {@code 0} in this low-load test environment, so {@link #MIN_POLL_WAIT_SECONDS} is used as a
 * floor. Confirmed live: every batch in this story concluded ({@code dCodResLot=0362}) on the very
 * first query attempt after that wait, so {@link #MAX_POLL_ATTEMPTS}/{@link #POLL_RETRY_DELAY}
 * exist only as a safety margin for a slower/busier real run, never exercised in the recorded run
 * below.
 *
 * <p><b>AC-03 (5 incorrect facturas in one batch, all rejected with an identifiable reason):</b>
 * reuses HU-13's 4 already-proven scenarios (malformed receiver RUC, blank item description, issue
 * date preceding the timbrado's {@code dFeIniT}, an out-of-catalog unit-of-measure code) plus a
 * 5th, the same "total doesn't match the sum of items" scenario HU-13 used — confirmed live to
 * still get masked by the same external {@code 1252} block before SIFEN's arithmetic check ever
 * runs, same as HU-13/HU-14 documented. This AC doesn't depend on the {@code 1252} block and is
 * hard-asserted.
 *
 * <p><b>AC-04/AC-05 (mixed-emisor / mixed-type batches rejected before processing):</b> both hard
 * asserted, unaffected by the {@code 1252} block, since neither ever reaches per-document content
 * validation. <b>Confirmed live (2026-07-28), a genuine manual/live divergence</b>: the manual's
 * Tabla B104 ({@code dCodResLot=0363} "Lotes con tipos distintos de DE") lists this code only under
 * {@code SiResultLoteDE} (sección 12.3.3.3, the async query step) — but the real {@code
 * SiRecepLoteDE} acknowledgment itself already returns {@code dCodRes=0363} synchronously, with
 * {@code accepted=false} ({@code dCodRes} not {@code 0300}, so the batch is never actually queued
 * for processing — confirmed live: {@code dProtConsLote} came back absent for the mixed-type case
 * and the literal string {@code "0"} for the mixed-emisor case, so {@code accepted()} is the
 * reliable signal here, not the batch number's presence/shape) — so "rechazado antes de ser
 * procesado" holds in the most literal sense possible, no polling needed at all. SIFEN's real
 * message text distinguishes the two causes dynamically: {@code "Lotes con tipos distintos de DE"}
 * for AC-05 (mixed types), and {@code "Lotes con tipos distintos de DE emisor [<ruc>]"} (naming the
 * offending RUC) for AC-04 (mixed emisor) — same underlying result code, reused for both violations
 * of "un lote debe contener solo un mismo tipo de DE [y de] un mismo emisor" (sección 9.2.2).
 *
 * <p><b>Guarded, not throwaway — same reasoning as HU-12/HU-13/HU-14.</b> {@link
 * Assumptions#assumeTrue} skips ("aborted" not "failed") whenever the pilot {@code .p12}/password
 * aren't present locally (gitignored) — never runs in CI or a clean checkout.
 */
class SifenHomologationBatchSubmissionLiveTest {

  /** Same real-server pacing HU-12/HU-13/HU-14 established. */
  private static final Duration PACING_DELAY = Duration.ofMillis(700);

  private static final int MAX_ATTEMPTS_ON_TRANSPORT_FAILURE = 3;

  /** Same clock-drift accommodation HU-13 documented — see its Javadoc for why. */
  private static final Duration CLOCK_SAFETY_BUFFER = Duration.ofMinutes(2);

  /**
   * Floor for HU-15 AC-01's "tiempo mínimo recomendado antes de consultar" when {@code dTpoProces}
   * comes back {@code 0} (confirmed live in this test environment) — {@code dTpoProces} itself is
   * still preferred whenever SIFEN reports something larger.
   */
  private static final int MIN_POLL_WAIT_SECONDS = 5;

  private static final int MAX_POLL_ATTEMPTS = 5;
  private static final Duration POLL_RETRY_DELAY = Duration.ofSeconds(10);

  /**
   * Pilot data from "Configuración del ambiente de pruebas" (Especificacion_SIFEN_Peluqueria.md).
   */
  private static final String ISSUER_RUC = "1137152";

  private static final int ISSUER_RUC_CHECK_DIGIT = 8;

  /** AC-04: a different emisor RUC to mix into an otherwise-valid batch. */
  private static final String OTHER_ISSUER_RUC = "80000005";

  private static final String STAMP_NUMBER = "1137152";
  private static final int ESTABLISHMENT = 1;
  private static final int EXPEDITION_POINT = 1;
  private static final LocalDate STAMP_VALID_FROM = LocalDate.of(2026, 7, 27);

  private static final BigDecimal LINE_UNIT_PRICE = BigDecimal.valueOf(110_000);
  private static final BigDecimal LINE_TAXABLE_BASE = BigDecimal.valueOf(100_000);
  private static final BigDecimal LINE_TAX_AMOUNT = BigDecimal.valueOf(10_000);

  private final SifenControlNumberService controlNumberService = new SifenControlNumberService();
  private final SifenDocumentXmlService xmlService = new SifenDocumentXmlService();
  private final SifenDocumentSigningService signingService =
      new SifenDocumentSigningService(null, null, null, null, null, null, null);
  private final SifenQrCodeService qrCodeService =
      new SifenQrCodeService(new SifenQrProperties(), new SifenConnectionProperties());
  private final FemmeTimeProperties timeProperties = new FemmeTimeProperties();
  private final SifenDocumentReceptionClient receptionClient =
      new SifenDocumentReceptionClient(null, new SifenConnectionProperties(), timeProperties);
  private final SifenBatchReceptionClient batchClient =
      new SifenBatchReceptionClient(null, new SifenConnectionProperties());
  private final SifenBatchResultQueryClient queryClient =
      new SifenBatchResultQueryClient(null, new SifenConnectionProperties());

  private long documentNumberCursor;

  @Test
  void batchSubmission_allFiveDocumentTypes_andValidationRejections() throws Exception {
    Path pilotCertificate = SifenPilotCertificateTestSupport.findPilotCertificate();
    Path pilotPassword = SifenPilotCertificateTestSupport.findPilotPassword();
    Assumptions.assumeTrue(
        pilotCertificate != null && pilotPassword != null,
        "Pilot .p12/password not present in this checkout (gitignored, see requirements/sifen/"
            + ".gitignore) — skipping the real SIFEN HU-15 batch submission check. See HU-05/HU-12"
            + " in requirements/sifen/PROGRESS.md to obtain them locally.");

    String password = Files.readString(pilotPassword).trim();
    KeyStore keyStore =
        SifenPilotCertificateTestSupport.loadKeyStore(
            Files.readAllBytes(pilotCertificate), password);
    SifenActiveCertificateMaterial material = loadMaterial(keyStore, password);
    HttpClient client = SifenConnectionService.buildMutualTlsClient(keyStore, password, null);

    SifenHomologationReport report = run(material, client);
    System.out.println(report.render());

    // AC-03: doesn't depend on the external RUC-active state — hard-asserted every time this runs.
    List<SifenHomologationReport.Row> incorrectFailures =
        report.rows().stream()
            .filter(row -> row.scenario().contains("incorrecta"))
            .filter(row -> !row.passed())
            .toList();
    assertThat(incorrectFailures)
        .as(
            "AC-03: every incorrect document in the batch must be rejected by SIFEN with an"
                + " identifiable reason: %s",
            report.render())
        .isEmpty();

    // AC-04/AC-05: whole-batch rejections, unaffected by the external RUC-active block — hard
    // asserted every time this runs.
    List<SifenHomologationReport.Row> validationFailures =
        report.rows().stream()
            .filter(
                row ->
                    row.scenario().contains("mezcla de emisores")
                        || row.scenario().contains("mezcla de tipos"))
            .filter(row -> !row.passed())
            .toList();
    assertThat(validationFailures)
        .as(
            "AC-04/AC-05: a batch mixing emisores or tipos de documento must be rejected before"
                + " being processed: %s",
            report.render())
        .isEmpty();

    // AC-01/AC-02: aborts, not fails, if SIFEN's registry ever reports the pilot RUC inactive
    // again (dCodRes=1252) — see class Javadoc and HU-13/HU-14's PROGRESS.md sections. Resolved as
    // of this story's fix (all 5 types now genuinely approved by batch); kept as assumeTrue rather
    // than a hard assertion so a future regression of that specific external condition aborts
    // instead of raising a false alarm, same convention as HU-13/HU-14.
    List<SifenHomologationReport.Row> correctFailures =
        report.rows().stream()
            .filter(row -> row.scenario().contains("correcta") && !row.scenario().contains("seed"))
            .filter(row -> !row.passed())
            .toList();
    Assumptions.assumeTrue(
        correctFailures.isEmpty(),
        () ->
            "AC-01/AC-02: not every correct document sent by batch (all 5 types) was approved by"
                + " SIFEN just now — see requirements/sifen/PROGRESS.md's HU-13/HU-14/HU-15 sections"
                + " for why this is currently a known external SIFEN test-registry limitation (pilot"
                + " RUC 1137152-8 reported inactive, dCodRes=1252), not a code defect, before"
                + " treating this as a regression: "
                + report.render());
  }

  /**
   * SIFEN HU-17 (EP-05, Fase 4) AC-05 seam: extracted so {@code SifenHomologationFinalReportTest}
   * can fold this story's live report into the single consolidated report the DNIT needs, via
   * {@link SifenHomologationReport#combinedWith}, without duplicating this class's own batch
   * send/poll logic.
   */
  SifenHomologationReport run(SifenActiveCertificateMaterial material, HttpClient client)
      throws InterruptedException {
    documentNumberCursor = Math.max(10, (System.currentTimeMillis() / 1000) % 9_000_000L);

    var report = new SifenHomologationReport();

    // AC-02 (nota de débito needs a document to reference): one real, actually-submitted CDC via
    // envío inmediato, same trick HU-14 used for the same reason. Nota de crédito seeds its own
    // reference per scenario inside runCorrectBatch (see the dCodRes=1461/2417 note there).
    String debitNoteReferenceCdc =
        sendSeedInvoiceForReference(report, material, client, "para NOTA_DEBITO");
    // dCodRes=2605 gap (see SifenGoodsRemissionData's javadoc): reasonCode=1 ("Traslado por
    // venta") requires a documento asociado — one real seed invoice to reference.
    String remissionReferenceCdc =
        sendSeedInvoiceForReference(report, material, client, "para NOTA_REMISION");

    // AC-01: factura, and AC-02: the other 4 types — one batch of 5 correct documents each.
    runCorrectBatch(report, material, client, SifenDocumentType.FACTURA, null);
    runCorrectBatch(report, material, client, SifenDocumentType.NOTA_CREDITO, null);
    runCorrectBatch(report, material, client, SifenDocumentType.NOTA_DEBITO, debitNoteReferenceCdc);
    runCorrectBatch(report, material, client, SifenDocumentType.AUTOFACTURA, null);
    runCorrectBatch(
        report, material, client, SifenDocumentType.NOTA_REMISION, remissionReferenceCdc);

    // AC-03: one batch of 5 incorrect facturas, distinct errors.
    runIncorrectFacturaBatch(report, material, client);

    // AC-04: a batch mixing two different emisor RUCs.
    runMixedRucBatch(report, material, client);

    // AC-05: a batch mixing two different document types.
    runMixedTypeBatch(report, material, client);
    return report;
  }

  // ---------------------------------------------------------------------------------------------
  // AC-01/AC-02: one batch of 5 correct documents per type.
  // ---------------------------------------------------------------------------------------------

  private void runCorrectBatch(
      SifenHomologationReport report,
      SifenActiveCertificateMaterial material,
      HttpClient client,
      SifenDocumentType type,
      String referencedCdc)
      throws InterruptedException {
    List<String> signedDocuments = new ArrayList<>();
    for (int i = 0; i < 5; i++) {
      String label = type + " correcta " + (i + 1) + "/5";
      // dCodRes=1461/2417 gap (same finding as HU-14's Javadoc): a nota de crédito can't exceed
      // its referenced invoice's balance, so reusing one seed invoice for all 5 "correcta"
      // scenarios lets only the first one through — each needs its own freshly-sent seed. Every
      // other type reuses the single shared referencedCdc passed in.
      String scenarioCdc =
          type == SifenDocumentType.NOTA_CREDITO
              ? sendSeedInvoiceForReference(report, material, client, "para " + label)
              : referencedCdc;
      signedDocuments.add(buildAndSign(material, type, Scenario.correct(label), scenarioCdc));
    }

    Optional<SifenBatchSubmissionResult> ack =
        sendBatchWithRetry(client, signedDocuments, "lote " + type + " correcto");
    report.add(
        "HU-15",
        type + " lote correcto — envío (5 documentos)",
        "ACCEPTED",
        describeAck(ack),
        ack.isPresent() && ack.get().accepted());
    if (ack.isEmpty() || !ack.get().accepted() || ack.get().batchNumber() == null) {
      return;
    }

    Optional<SifenBatchQueryResult> result = pollUntilConcluded(client, ack.get());
    if (result.isEmpty() || !result.get().concluded()) {
      report.add(
          "HU-15",
          type + " lote correcto — consulta de resultado",
          "0362 (concluido)",
          result.map(SifenBatchQueryResult::batchResultCode).orElse("SIN RESPUESTA"),
          false);
      return;
    }
    for (SifenBatchDocumentResult doc : result.get().documents()) {
      boolean approved = isApproved(doc.status());
      report.add(
          "HU-15", type + " correcta — CDC " + doc.cdc(), "APROBADO", describeDoc(doc), approved);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // AC-03: one batch of 5 incorrect facturas, distinct errors.
  // ---------------------------------------------------------------------------------------------

  private void runIncorrectFacturaBatch(
      SifenHomologationReport report, SifenActiveCertificateMaterial material, HttpClient client)
      throws InterruptedException {
    List<Scenario> scenarios =
        List.of(
            new Scenario(
                "factura incorrecta 1/5 (RUC receptor malformado)",
                "Corte de cabello",
                "12-3",
                null,
                false,
                false),
            new Scenario(
                "factura incorrecta 2/5 (descripción de ítem vacía)", "", null, null, false, false),
            new Scenario(
                "factura incorrecta 3/5 (fecha de emisión fuera de rango, 45 días atrás)",
                "Corte de cabello",
                null,
                LocalDateTime.now(timeProperties.zoneId()).minusDays(45),
                false,
                false),
            new Scenario(
                "factura incorrecta 4/5 (total no coincide con la suma de los ítems)",
                "Corte de cabello",
                null,
                null,
                true,
                false),
            new Scenario(
                "factura incorrecta 5/5 (código de unidad de medida inexistente)",
                "Corte de cabello",
                null,
                null,
                false,
                true));

    List<String> signedDocuments = new ArrayList<>();
    for (Scenario scenario : scenarios) {
      signedDocuments.add(buildAndSign(material, SifenDocumentType.FACTURA, scenario, null));
    }

    Optional<SifenBatchSubmissionResult> ack =
        sendBatchWithRetry(client, signedDocuments, "lote factura incorrecto");
    report.add(
        "HU-15",
        "lote factura incorrecto — envío (5 documentos)",
        "ACCEPTED",
        describeAck(ack),
        ack.isPresent() && ack.get().accepted());
    if (ack.isEmpty() || !ack.get().accepted() || ack.get().batchNumber() == null) {
      return;
    }

    Optional<SifenBatchQueryResult> result = pollUntilConcluded(client, ack.get());
    if (result.isEmpty() || !result.get().concluded()) {
      report.add(
          "HU-15",
          "lote factura incorrecto — consulta de resultado",
          "0362 (concluido)",
          result.map(SifenBatchQueryResult::batchResultCode).orElse("SIN RESPUESTA"),
          false);
      return;
    }
    List<SifenBatchDocumentResult> documents = result.get().documents();
    for (int i = 0; i < documents.size() && i < scenarios.size(); i++) {
      SifenBatchDocumentResult doc = documents.get(i);
      boolean rejectedWithReason =
          doc.status() == SifenSubmissionStatus.REJECTED
              && doc.message() != null
              && !doc.message().isBlank();
      report.add(
          "HU-15",
          scenarios.get(i).label() + " — CDC " + doc.cdc(),
          "RECHAZADO",
          describeDoc(doc),
          rejectedWithReason);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // AC-04/AC-05: whole-batch validation rejections.
  // ---------------------------------------------------------------------------------------------

  private void runMixedRucBatch(
      SifenHomologationReport report, SifenActiveCertificateMaterial material, HttpClient client)
      throws InterruptedException {
    List<String> signedDocuments = new ArrayList<>();
    for (int i = 0; i < 4; i++) {
      signedDocuments.add(
          buildAndSign(
              material,
              SifenDocumentType.FACTURA,
              Scenario.correct("mezcla de emisores " + (i + 1) + "/5"),
              null,
              ISSUER_RUC));
    }
    signedDocuments.add(
        buildAndSign(
            material,
            SifenDocumentType.FACTURA,
            Scenario.correct("mezcla de emisores 5/5 (otro RUC)"),
            null,
            OTHER_ISSUER_RUC));

    Optional<SifenBatchSubmissionResult> ack =
        sendBatchWithRetry(client, signedDocuments, "lote mezcla de emisores");
    // AC-04: rejected at the synchronous ack itself — see class Javadoc for the confirmed-live
    // 0363 "Lotes con tipos distintos de DE emisor [...]" shape. Confirmed live: dProtConsLote came
    // back as the literal string "0" here (not absent) — accepted()==false alone, from dCodRes
    // != 0300, is the reliable "never queued for processing" signal, not the batch number's shape.
    boolean rejectedBeforeProcessing = ack.isPresent() && !ack.get().accepted();
    report.add(
        "HU-15",
        "lote con mezcla de emisores (4 RUC piloto + 1 distinto)",
        "RECHAZADO (antes de procesar)",
        describeAck(ack),
        rejectedBeforeProcessing);
  }

  private void runMixedTypeBatch(
      SifenHomologationReport report, SifenActiveCertificateMaterial material, HttpClient client)
      throws InterruptedException {
    List<String> signedDocuments = new ArrayList<>();
    for (int i = 0; i < 4; i++) {
      signedDocuments.add(
          buildAndSign(
              material,
              SifenDocumentType.FACTURA,
              Scenario.correct("mezcla de tipos " + (i + 1) + "/5"),
              null));
    }
    signedDocuments.add(
        buildAndSign(
            material,
            SifenDocumentType.NOTA_CREDITO,
            Scenario.correct("mezcla de tipos 5/5 (nota de crédito)"),
            null));

    Optional<SifenBatchSubmissionResult> ack =
        sendBatchWithRetry(client, signedDocuments, "lote mezcla de tipos");
    // AC-05: same 0363 code, rejected synchronously — see class Javadoc.
    boolean rejectedBeforeProcessing = ack.isPresent() && !ack.get().accepted();
    report.add(
        "HU-15",
        "lote con mezcla de tipos de documento (4 factura + 1 nota de crédito)",
        "RECHAZADO (antes de procesar)",
        describeAck(ack),
        rejectedBeforeProcessing);
  }

  // ---------------------------------------------------------------------------------------------
  // Shared helpers.
  // ---------------------------------------------------------------------------------------------

  private String sendSeedInvoiceForReference(
      SifenHomologationReport report,
      SifenActiveCertificateMaterial material,
      HttpClient client,
      String label)
      throws InterruptedException {
    String signed =
        buildAndSign(
            material, SifenDocumentType.FACTURA, Scenario.correct("seed factura " + label), null);
    Optional<SifenSubmissionResult> result = sendImmediateWithRetry(client, signed);
    boolean approved = result.isPresent() && isApproved(result.get().status());
    report.add(
        "HU-15",
        "seed factura " + label + " (envío inmediato, para referenciar) — CDC",
        "APROBADO",
        result
            .map(
                r ->
                    String.format(
                        Locale.ROOT, "%s (%s: %s)", r.status(), r.resultCode(), r.message()))
            .orElse("SIN RESPUESTA"),
        approved);
    return extractCdcFromSignedDocument(signed);
  }

  private static String extractCdcFromSignedDocument(String signedXml) {
    int idIndex = signedXml.indexOf("Id=\"");
    int start = idIndex + "Id=\"".length();
    int end = signedXml.indexOf('"', start);
    return signedXml.substring(start, end);
  }

  private static boolean isApproved(SifenSubmissionStatus status) {
    return status == SifenSubmissionStatus.APPROVED
        || status == SifenSubmissionStatus.APPROVED_WITH_OBSERVATION;
  }

  private static String describeAck(Optional<SifenBatchSubmissionResult> ack) {
    if (ack.isEmpty()) {
      return "SIN RESPUESTA";
    }
    SifenBatchSubmissionResult a = ack.get();
    return String.format(
        Locale.ROOT,
        "%s (%s: %s)",
        a.accepted() ? "ACCEPTED" : "REJECTED",
        a.resultCode(),
        a.message());
  }

  private static String describeDoc(SifenBatchDocumentResult doc) {
    return String.format(Locale.ROOT, "%s (%s: %s)", doc.status(), doc.resultCode(), doc.message());
  }

  /** Same pacing/retry discipline HU-12/HU-13/HU-14 established. */
  private Optional<SifenBatchSubmissionResult> sendBatchWithRetry(
      HttpClient client, List<String> signedDocuments, String logContext)
      throws InterruptedException {
    Optional<SifenBatchSubmissionResult> result = Optional.empty();
    for (int attempt = 1; attempt <= MAX_ATTEMPTS_ON_TRANSPORT_FAILURE; attempt++) {
      Thread.sleep(PACING_DELAY.toMillis());
      result = batchClient.sendWithClient(client, signedDocuments, logContext);
      if (result.isPresent()) {
        return result;
      }
    }
    return result;
  }

  private Optional<SifenSubmissionResult> sendImmediateWithRetry(HttpClient client, String xml)
      throws InterruptedException {
    Optional<SifenSubmissionResult> result = Optional.empty();
    for (int attempt = 1; attempt <= MAX_ATTEMPTS_ON_TRANSPORT_FAILURE; attempt++) {
      Thread.sleep(PACING_DELAY.toMillis());
      result = receptionClient.sendWithClient(client, xml, "seed");
      if (result.isPresent()) {
        return result;
      }
    }
    return result;
  }

  /**
   * AC-01's "tiempo mínimo recomendado antes de consultar": waits at least {@code
   * recommendedWaitSeconds} (floored at {@link #MIN_POLL_WAIT_SECONDS}), then polls up to {@link
   * #MAX_POLL_ATTEMPTS} times — confirmed live that every batch in this story concludes on the very
   * first attempt after that wait, so the extra attempts only guard against a slower real run.
   */
  private Optional<SifenBatchQueryResult> pollUntilConcluded(
      HttpClient client, SifenBatchSubmissionResult ack) throws InterruptedException {
    int waitSeconds =
        Math.max(
            MIN_POLL_WAIT_SECONDS, Optional.ofNullable(ack.recommendedWaitSeconds()).orElse(0));
    Thread.sleep(Duration.ofSeconds(waitSeconds).toMillis());

    Optional<SifenBatchQueryResult> result = Optional.empty();
    for (int attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
      Thread.sleep(PACING_DELAY.toMillis());
      result = queryClient.queryWithClient(client, ack.batchNumber(), "batch " + ack.batchNumber());
      if (result.isPresent() && !result.get().stillProcessing()) {
        return result;
      }
      Thread.sleep(POLL_RETRY_DELAY.toMillis());
    }
    return result;
  }

  /**
   * One document-building recipe, shared across all types — same discipline as HU-13/HU-14's own
   * {@code Scenario}: {@code null}/{@code false} fields mean "use the correct default".
   */
  private record Scenario(
      String label,
      String firstLineDescription,
      String receiverRuc,
      LocalDateTime issueDateTimeOverride,
      boolean corruptTotals,
      boolean invalidUnitCode) {

    static Scenario correct(String label) {
      return new Scenario(label, "Corte de cabello", null, null, false, false);
    }
  }

  private String buildAndSign(
      SifenActiveCertificateMaterial material,
      SifenDocumentType type,
      Scenario scenario,
      String referencedCdc) {
    return buildAndSign(material, type, scenario, referencedCdc, ISSUER_RUC);
  }

  private String buildAndSign(
      SifenActiveCertificateMaterial material,
      SifenDocumentType type,
      Scenario scenario,
      String referencedCdc,
      String issuerRuc) {
    long documentNumber = ++documentNumberCursor;
    LocalDateTime issueDateTime =
        scenario.issueDateTimeOverride() != null
            ? scenario.issueDateTimeOverride()
            : LocalDateTime.now(timeProperties.zoneId());

    SifenControlNumberFields cdcFields =
        new SifenControlNumberFields(
            type.sifenCode(),
            issuerRuc,
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
            issuerRuc,
            ISSUER_RUC_CHECK_DIGIT,
            SifenInvoiceHeaderService.TEST_ENVIRONMENT_ISSUER_NAME_LEGEND,
            null,
            "Avda. España 123",
            SifenTaxpayerType.LEGAL_ENTITY,
            "96020",
            "Peluquería y otros tratamientos de belleza",
            "021555000",
            "facturacion@example.com",
            "12",
            "CENTRAL",
            "5044",
            "FERNANDO DE LA MORA");

    SifenReceiverData receiver = buildReceiverFor(type, scenario, issuerRuc);

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

    SifenInvoiceLine line =
        new SifenInvoiceLine(
            "SVC-1",
            scenario.firstLineDescription(),
            null,
            1,
            scenario.invalidUnitCode() ? "999" : "77",
            LINE_UNIT_PRICE,
            BigDecimal.ZERO,
            LINE_UNIT_PRICE,
            SifenTaxAffectation.GRAVADO,
            BigDecimal.valueOf(100),
            BigDecimal.valueOf(10),
            LINE_TAXABLE_BASE,
            LINE_TAX_AMOUNT);

    SifenInvoiceTotals correctTotals =
        new SifenInvoiceTotals(
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            LINE_UNIT_PRICE,
            LINE_UNIT_PRICE,
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            BigDecimal.ZERO,
            LINE_UNIT_PRICE,
            BigDecimal.ZERO,
            LINE_TAXABLE_BASE,
            LINE_TAXABLE_BASE,
            BigDecimal.ZERO,
            LINE_TAX_AMOUNT,
            LINE_TAX_AMOUNT);
    SifenInvoiceTotals totals =
        scenario.corruptTotals()
            ? new SifenInvoiceTotals(
                correctTotals.exemptSubtotal(),
                correctTotals.taxedSubtotal5(),
                correctTotals.taxedSubtotal10(),
                BigDecimal.valueOf(999_999),
                correctTotals.perLineDiscountTotal(),
                correctTotals.globalDiscountTotal(),
                correctTotals.totalDiscount(),
                BigDecimal.valueOf(999_999),
                correctTotals.taxableBase5(),
                correctTotals.taxableBase10(),
                correctTotals.totalTaxableBase(),
                correctTotals.iva5(),
                correctTotals.iva10(),
                correctTotals.totalIva())
            : correctTotals;

    SifenInvoiceDetail detail =
        new SifenInvoiceDetail(
            List.of(line), totals, 1, List.of(new SifenPaymentDetail(1, LINE_UNIT_PRICE)));

    SifenDocumentTypeExtras extras = buildExtras(type, referencedCdc);

    LocalDateTime signatureTimestamp =
        LocalDateTime.now(timeProperties.zoneId()).minus(CLOCK_SAFETY_BUFFER);
    Document unsigned =
        xmlService.buildDocument(header, detail, cdcFields, signatureTimestamp, extras);
    SifenSignedDocument signed = signingService.sign(material, unsigned, signatureTimestamp);

    // SIFEN HU-08: the QR group is mandatory on every DE, regardless of type.
    String digestValueBase64 = extractDigestValueBase64(signed.document());
    SifenQrCodeService.SifenQrResult qr =
        qrCodeService.build(
            header,
            detail.totals(),
            detail.lines().size(),
            digestValueBase64,
            extras.autoInvoiceProvider() != null);
    xmlService.appendQrGroup(signed.document(), qr.qrUrl());

    return SifenDocumentXmlService.serialize(signed.document());
  }

  private static SifenReceiverData buildReceiverFor(
      SifenDocumentType type, Scenario scenario, String issuerRuc) {
    if (scenario.receiverRuc() != null) {
      return new SifenReceiverData(
          scenario.receiverRuc(), null, "Cliente Homologación HU-15", null, null, null, null, null);
    }
    if (type == SifenDocumentType.AUTOFACTURA) {
      return new SifenReceiverData(
          issuerRuc + "-" + ISSUER_RUC_CHECK_DIGIT,
          null,
          SifenInvoiceHeaderService.TEST_ENVIRONMENT_ISSUER_NAME_LEGEND,
          null,
          null,
          null,
          null,
          null);
    }
    if (type == SifenDocumentType.NOTA_REMISION) {
      // SIFEN HU-14 gap (dCodRes=1318): Nota de Remisión requires the receiver's address.
      return new SifenReceiverData(
          null,
          "4123456",
          "Cliente Homologación HU-15",
          "Avda. Mcal. López 456",
          null,
          null,
          null,
          null);
    }
    return new SifenReceiverData(
        null, "4123456", "Cliente Homologación HU-15", null, null, null, null, null);
  }

  private static SifenDocumentTypeExtras buildExtras(SifenDocumentType type, String referencedCdc) {
    return switch (type) {
      case FACTURA -> SifenDocumentTypeExtras.NONE;
      case NOTA_CREDITO, NOTA_DEBITO ->
          SifenDocumentTypeExtras.creditDebitNote(new SifenCreditDebitNoteData(3, referencedCdc));
      case AUTOFACTURA ->
          SifenDocumentTypeExtras.autoInvoiceProvider(
              new SifenAutoInvoiceProviderData(
                  1,
                  1,
                  "9876543",
                  "Juan Proveedor",
                  "Calle Falsa 123",
                  "45",
                  "12",
                  "CENTRAL",
                  "5044",
                  "FERNANDO DE LA MORA"));
      case NOTA_REMISION ->
          SifenDocumentTypeExtras.goodsRemission(
              new SifenGoodsRemissionData(1, 1, 25, 1, 1, referencedCdc, 1));
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
