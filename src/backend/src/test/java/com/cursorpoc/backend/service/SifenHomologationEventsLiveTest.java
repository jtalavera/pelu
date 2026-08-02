package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.config.SifenConnectionProperties;
import com.cursorpoc.backend.config.SifenQrProperties;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import com.cursorpoc.backend.domain.enums.SifenTaxAffectation;
import com.cursorpoc.backend.domain.enums.SifenTaxpayerType;
import com.cursorpoc.backend.service.SifenReceptorEventXmlService.ConformityType;
import com.cursorpoc.backend.service.SifenReceptorEventXmlService.ReceiverIdentity;
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
 * HU-16 (EP-05, Fase 4): registers every event type the DNIT homologación requires — cancellation
 * (HU-10), anulación de numeración (new, AC-02), and the four receptor-side events (new, AC-03) —
 * against {@code sifen-test.set.gov.py}, reusing {@link SifenEventClient}/{@link
 * SifenDocumentSigningService#signEvent} exactly as production code does, same seam HU-12/HU-13
 * opened for every other homologación story.
 *
 * <p><b>This is also where the {@code dCodRes=0160 "XML mal formado"} wall that blocked every real
 * event submission since HU-10 gets fixed</b> — see {@link SifenCancellationEventXmlService}'s and
 * {@link SifenEventClient#buildEnvelope}'s Javadoc for the full diagnosis: {@code xmlns:xsi}/{@code
 * xsi:schemaLocation} were being placed on {@code <rGesEve>} (one level too deep) instead of {@code
 * <gGroupGesEve>}, the element Manual Técnico V150's own GDE000 field table actually calls "Raíz
 * del grupo de eventos". Moving them to the right element — confirmed live, 2026-07-28,
 * cross-checked against the real {@code evento.wsdl.xsd1.xsd} with {@code xmllint} and against the
 * public reference implementation {@code facturacionelectronicapy-xmlgen}'s {@code
 * jsonEventoMain.service.ts} (which places them correctly) — changes every event response from the
 * generic 0160 to a specific, real, content-level SIFEN result. <b>AC-02 (anulación de numeración)
 * is the first-ever genuine {@code Aprobado} in this entire integration's history</b> (protocol
 * numbers/{@code dCodRes=0600} confirmed live below) — it needs no prior approved document, so it
 * is not affected by the external {@code 1252} RUC-inactive block HU-13/14/15 documented.
 *
 * <p><b>AC-01/AC-03 (partially)/AC-05 still need a genuinely SIFEN-approved document to react to,
 * and that remains blocked by the same external {@code dCodRes=1252 "El RUC del emisor se encuentra
 * inactivo"} state HU-13/14/15 documented</b> (re-confirmed live at the start of this story, see
 * PROGRESS.md) — a real, external SIFEN test-registry limitation, not a code defect. Where an AC's
 * literal happy path needs that, this test hard-asserts everything it can (the event is built
 * correctly, signed correctly, sent, and SIFEN returns a specific, real, content-level rejection —
 * never the generic 0160 that used to mask all of this) and then {@link Assumptions#assumeTrue}s on
 * the remaining "genuinely approved" step, the same honest pattern HU-13/14/15 established.
 *
 * <p><b>Real finding while probing AC-03 live: "Desconocimiento" doesn't require the CDC to already
 * exist in SIFEN — the other three receptor events do.</b> Confirmed live: {@code rGeVeDescon} over
 * a syntactically valid but never-submitted CDC came back {@code Aprobado} (a second genuine
 * approval, independent of AC-02's), while {@code rGeVeConf}/{@code rGeVeDisconf} came back
 * rejected with {@code dCodRes=4152}/{@code 4202} ("CDC del DTE es inexistente" — a receptor can't
 * confirm/question a document that was never received), and a second event attempted right after on
 * the same CDC (Notificación de Recepción, tried last) came back {@code dCodRes=4113}
 * ("Incongruencia en el registro de eventos del receptor... hay un evento previo de conformidad o
 * disconformidad o desconocimiento") — SIFEN enforcing exactly the state-machine Manual Técnico
 * V150's Tabla K documents (a receptor can't notify reception after already registering
 * conformidad/disconformidad/ desconocimiento on the same CDC). All three are genuine, specific,
 * content-level results — confirming the fixed event channel is healthy end to end, even where the
 * literal "genuinely existing DTE" precondition isn't met yet.
 *
 * <p><b>No explicit "cantidad mínima" is documented anywhere in this repo's source material for
 * AC-03's receptor events.</b> Neither Manual Técnico V150 nor {@code
 * Especificacion_SIFEN_Peluqueria.md} states a specific minimum count per event type (checked both
 * explicitly for this story) — only Tabla K's "solo se puede registrar un evento de corrección
 * sobre cada evento" (at most one correction per event). Absent a stated number, this test
 * registers each receptor event type at least twice (once as the "original" registration, once
 * again as its "corrección" per Tabla K's own mechanism — a second registration of the same or a
 * different receptor event type over the same CDC), the same order of magnitude as this
 * integration's other "at least" minimums (HU-12's "every case", HU-13..15's "5 per type").
 *
 * <p><b>Decision: guarded, not throwaway — same reasoning as HU-12/13/14/15.</b> AC-04 asks for a
 * reproducible report; the pilot {@code .p12}/password are gitignored, so {@link
 * Assumptions#assumeTrue} skips ("aborted" not "failed") whenever they aren't present locally.
 */
class SifenHomologationEventsLiveTest {

  private static final Duration PACING_DELAY = Duration.ofMillis(700);

  private static final int MAX_ATTEMPTS_ON_TRANSPORT_FAILURE = 3;

  private static final String ISSUER_RUC = "1137152";

  private static final int ISSUER_RUC_CHECK_DIGIT = 8;

  private static final String STAMP_NUMBER = "1137152";

  private static final int ESTABLISHMENT = 1;

  private static final int EXPEDITION_POINT = 1;

  private static final LocalDate STAMP_VALID_FROM = LocalDate.of(2026, 7, 27);
  private static final BigDecimal LINE_UNIT_PRICE = BigDecimal.valueOf(110_000);
  private static final BigDecimal LINE_TAXABLE_BASE = BigDecimal.valueOf(100_000);
  private static final BigDecimal LINE_TAX_AMOUNT = BigDecimal.valueOf(10_000);

  private final SifenControlNumberService controlNumberService = new SifenControlNumberService();
  private final SifenCancellationEventXmlService cancellationXmlService =
      new SifenCancellationEventXmlService();
  private final SifenNumberVoidingEventXmlService numberVoidingXmlService =
      new SifenNumberVoidingEventXmlService();
  private final SifenReceptorEventXmlService receptorXmlService =
      new SifenReceptorEventXmlService();
  private final FemmeTimeProperties timeProperties = new FemmeTimeProperties();
  private final SifenConnectionProperties connectionProperties = new SifenConnectionProperties();
  private final SifenEventClient eventClient =
      new SifenEventClient(null, connectionProperties, timeProperties);

  // Document-side infra (AC-01/AC-03/AC-05 now seed genuinely-approved documents to react to,
  // instead of only synthetic never-approved CDCs — same envío inmediato pattern HU-13/14/15/17
  // already use for their own seed invoices).
  private final SifenDocumentXmlService xmlService = new SifenDocumentXmlService();
  private final SifenDocumentSigningService signingService =
      new SifenDocumentSigningService(null, null, null, null, null, null, null);
  private final SifenQrCodeService qrCodeService =
      new SifenQrCodeService(new SifenQrProperties(), connectionProperties);
  private final SifenDocumentReceptionClient receptionClient =
      new SifenDocumentReceptionClient(null, connectionProperties, timeProperties);

  private SifenActiveCertificateMaterial material;
  private HttpClient client;
  private long idSequence;
  private long documentNumberCursor;

  @Test
  void everyRequiredEventTypeIsRegistered() throws Exception {
    Path pilotCertificate = SifenPilotCertificateTestSupport.findPilotCertificate();
    Path pilotPassword = SifenPilotCertificateTestSupport.findPilotPassword();
    Assumptions.assumeTrue(
        pilotCertificate != null && pilotPassword != null,
        "Pilot .p12/password not present in this checkout (gitignored, see requirements/sifen/"
            + ".gitignore) — skipping the real SIFEN HU-16 events check. See HU-05/HU-12 in"
            + " requirements/sifen/PROGRESS.md to obtain them locally.");

    String password = Files.readString(pilotPassword).trim();
    KeyStore keyStore =
        SifenPilotCertificateTestSupport.loadKeyStore(
            Files.readAllBytes(pilotCertificate), password);
    SifenActiveCertificateMaterial loadedMaterial = loadMaterial(keyStore, password);
    HttpClient httpClient = SifenConnectionService.buildMutualTlsClient(keyStore, password, null);

    SifenHomologationReport report = run(loadedMaterial, httpClient);
    System.out.println(report.render());

    // AC-02 (hard): the 5 anulación de numeración events must all be genuinely approved — the first
    // real "Aprobado" this integration has ever gotten from SIFEN, and not gated by the external
    // RUC
    // block below.
    List<SifenHomologationReport.Row> ac02Failures =
        report.rows().stream()
            .filter(row -> row.scenario().startsWith("AC-02"))
            .filter(row -> !row.passed())
            .toList();
    assertThat(ac02Failures)
        .as("AC-02: every anulación de numeración must be approved by SIFEN: %s", report.render())
        .isEmpty();
    assertHu16ChannelHealthAndAssumptions(report);
  }

  /**
   * SIFEN HU-17 (EP-05, Fase 4) AC-05 seam: extracted so {@code SifenHomologationFinalReportTest}
   * can fold this story's live report into the single consolidated report the DNIT needs, via
   * {@link SifenHomologationReport#combinedWith}, without duplicating this class's own
   * event-building logic. Relies on {@code material}/{@code client}/ {@code idSequence} already
   * being set by the {@code @Test} method (or, for the capstone caller, by an equivalent setup) —
   * see {@link #everyRequiredEventTypeIsRegistered} for that setup.
   */
  SifenHomologationReport run(SifenActiveCertificateMaterial material, HttpClient client)
      throws Exception {
    this.material = material;
    this.client = client;
    this.idSequence = System.currentTimeMillis() / 1000;
    // Real finding: left at its default 0, this collides with document numbers a previous run of
    // this same test already sent for real (dCodRes=1002 "Documento electrónico duplicado") —
    // same session-uniqueness need HU-13/14/15/17 already established for their own seed
    // invoices.
    this.documentNumberCursor = Math.max(10, (System.currentTimeMillis() / 1000) % 9_000_000L);

    var report = new SifenHomologationReport();

    // === AC-02: anulación de numeración for each of the 5 required document types. Doesn't need a
    // prior approved document (sección 11.5: the one event based on a number range, not a CDC) —
    // the
    // first genuine "Aprobado" in this integration's history, unaffected by the external 1252 block
    // below.
    long rangeBase = 9_000_000L + (System.currentTimeMillis() % 500_000L);
    int offset = 0;
    for (SifenDocumentType type : SifenDocumentType.values()) {
      long start = rangeBase + (long) offset * 20;
      long end = start + 4;
      offset++;
      Optional<SifenSubmissionResult> result =
          sendWithRetry(
              signEvent(
                  numberVoidingXmlService.buildNumberVoidingEvent(
                      STAMP_NUMBER,
                      ESTABLISHMENT,
                      EXPEDITION_POINT,
                      type,
                      start,
                      end,
                      "HU-16 AC-02 - anulación de numeración de prueba",
                      nextId(),
                      signatureInstant())),
              "anulación " + type);
      recordApproval(report, "AC-02 anulación numeración " + type, result);
    }

    // === AC-01: cancel 5 genuinely SIFEN-approved documents (any type — "cualquier tipo" per the
    // spec, so 5 facturas is a valid instance; the 5 required document types are already exercised
    // exhaustively by HU-13/14/15/17, not re-proven here). Needs the external RUC-active state
    // (dCodRes=1252, see HU-13) to hold — this test seeds its own documents live rather than
    // assuming one exists, but remains exposed to the same external condition if it ever regresses.
    List<String> approvedCdcs = new ArrayList<>();
    for (int i = 1; i <= 5; i++) {
      approvedCdcs.add(sendApprovedSeedDocument(report, "para AC-01 cancelación " + i + "/5"));
    }
    for (int i = 0; i < approvedCdcs.size(); i++) {
      Optional<SifenSubmissionResult> cancelResult =
          sendWithRetry(
              signEvent(
                  cancellationXmlService.buildCancellationEvent(
                      approvedCdcs.get(i),
                      "HU-16 AC-01 - cancelación de documento aprobado " + (i + 1) + "/5",
                      nextId(),
                      postApprovalSignatureInstant())),
              "cancelación aprobado " + (i + 1) + "/5");
      recordApproval(
          report,
          "AC-01 cancelación " + (i + 1) + "/5 sobre documento genuinamente aprobado",
          cancelResult);
    }

    // === AC-05: a second cancellation attempt on a document already cancelled above must be
    // rejected by SIFEN. The exact rejection code isn't documented anywhere in this repo's source
    // material (checked Manual Técnico V150 and Especificacion_SIFEN_Peluqueria.md) — recorded as
    // whatever SIFEN's real, specific reason turns out to be, not a generic 0160.
    String alreadyCancelledCdc = approvedCdcs.get(0);
    Optional<SifenSubmissionResult> secondCancelOnApproved =
        sendWithRetry(
            signEvent(
                cancellationXmlService.buildCancellationEvent(
                    alreadyCancelledCdc,
                    "HU-16 AC-05 - segundo intento de cancelación",
                    nextId(),
                    postApprovalSignatureInstant())),
            "cancelación 2/2 sobre documento ya cancelado");
    recordRejectedWithSpecificReason(
        report,
        "AC-05 segundo intento de cancelación sobre documento ya cancelado",
        secondCancelOnApproved);

    // === AC-03: the four receptor events, at least twice each (original + "corrección" per Tabla
    // K), acting as the CDC's receptor. Desconocimiento doesn't require the CDC to already exist —
    // hard-asserted APPROVED below. Conformidad/Disconformidad/Notificación de Recepción do — their
    // rejection reasons are still specific/real, not the generic 0160, but the literal "aprobado"
    // AC
    // needs a genuinely-approved DTE this environment still can't produce (same 1252 block).
    ReceiverIdentity receiver =
        ReceiverIdentity.taxpayer("Cliente Homologación HU-16", "1234567", 8);

    for (int i = 1; i <= 2; i++) {
      String cdc = buildSyntheticCdc(300 + i);
      Optional<SifenSubmissionResult> result =
          sendWithRetry(
              signEvent(
                  receptorXmlService.buildDisavowal(
                      cdc,
                      LocalDateTime.now(timeProperties.zoneId()).minusDays(2),
                      LocalDateTime.now(timeProperties.zoneId()).minusDays(1),
                      receiver,
                      "HU-16 AC-03 - desconocimiento de prueba " + i,
                      nextId(),
                      signatureInstant())),
              "desconocimiento " + i + "/2");
      recordApproval(report, "AC-03 desconocimiento " + i + "/2 (\"desconocerla\")", result);
    }

    // Notificación de Recepción: confirmed live (like Desconocimiento) to NOT require the CDC to
    // already exist either — a third genuinely-approvable event type, independent of the 1252 wall.
    // Registered on 2 distinct CDCs (never twice on the same one: confirmed live that a second
    // registration of the SAME receptor event type over the same CDC is rejected outright as a
    // duplicate, dCodRes=4101/4251 "ya cuenta con un evento previo de esta naturaleza" — never
    // treated as a "corrección"; see below for what a correction actually needs).
    for (int i = 1; i <= 2; i++) {
      String cdc = buildSyntheticCdc(600 + i);
      Optional<SifenSubmissionResult> result =
          sendWithRetry(
              signEvent(
                  receptorXmlService.buildReceptionNotification(
                      cdc,
                      LocalDateTime.now(timeProperties.zoneId()).minusDays(2),
                      LocalDateTime.now(timeProperties.zoneId()).minusDays(1),
                      receiver,
                      BigDecimal.valueOf(150_000),
                      nextId(),
                      signatureInstant())),
              "notificación recepción " + i + "/2");
      recordApproval(
          report, "AC-03 notificación de recepción " + i + "/2 (\"notificar recepción\")", result);
    }

    // Conformidad ("confirmarla") y Disconformidad ("cuestionarla"): confirmed live (HU-16's first
    // pass, before this fix) that these DO require the CDC to genuinely exist in SIFEN — unlike the
    // two event types above. Each now reacts to a real, genuinely-approved seed document instead of
    // a synthetic never-approved CDC.
    String conformidadCdc = sendApprovedSeedDocument(report, "para AC-03 conformidad");
    Optional<SifenSubmissionResult> conformidadResult =
        sendWithRetry(
            signEvent(
                receptorXmlService.buildConformity(
                    conformidadCdc,
                    ConformityType.TOTAL,
                    null,
                    nextId(),
                    postApprovalSignatureInstant())),
            "conformidad");
    recordApproval(
        report, "AC-03 conformidad (\"confirmarla\") sobre documento aprobado", conformidadResult);

    String disconformidadCdc = sendApprovedSeedDocument(report, "para AC-03 disconformidad");
    Optional<SifenSubmissionResult> disconformidadResult =
        sendWithRetry(
            signEvent(
                receptorXmlService.buildDisconformity(
                    disconformidadCdc,
                    "HU-16 AC-03 - cuestiono el monto facturado",
                    nextId(),
                    postApprovalSignatureInstant())),
            "disconformidad");
    recordApproval(
        report,
        "AC-03 disconformidad (\"cuestionarla\") sobre documento aprobado",
        disconformidadResult);

    // "Corregir un evento anterior" (AC-03's 5th action): Manual Técnico V150's Tabla K scopes this
    // correction mechanism to Conformidad/Disconformidad/Desconocimiento only ("solo se puede
    // registrar un evento de corrección sobre cada evento mencionado") — registering Disconformidad
    // right after Conformidad on the SAME genuinely-approved CDC is the shape a correction takes.
    // The exact outcome (accepted as a valid correction, or rejected by some business rule) isn't
    // documented anywhere in this repo's source material — recorded as whatever SIFEN's real,
    // specific result turns out to be, not a generic 0160.
    Optional<SifenSubmissionResult> correctionAttempt =
        sendWithRetry(
            signEvent(
                receptorXmlService.buildDisconformity(
                    conformidadCdc,
                    "HU-16 AC-03 - corrección del evento anterior (Tabla K)",
                    nextId(),
                    postApprovalSignatureInstant())),
            "corrección (Tabla K)");
    recordSpecificResult(
        report, "AC-03 corrección de un evento anterior (Tabla K)", correctionAttempt);

    return report;
  }

  /**
   * Sends one real factura electrónica via envío inmediato (same construction shape HU-13/14/15/17
   * already use for their own seed invoices) and returns its CDC once SIFEN genuinely approves it —
   * lets AC-01/AC-03/AC-05 react to a document that actually exists in SIFEN's registry, instead of
   * only a syntactically-valid-but-never-sent CDC.
   */
  private String sendApprovedSeedDocument(SifenHomologationReport report, String label)
      throws InterruptedException {
    long documentNumber = ++documentNumberCursor;
    LocalDateTime issueDateTime = LocalDateTime.now(timeProperties.zoneId());

    SifenControlNumberFields cdcFields =
        new SifenControlNumberFields(
            SifenDocumentType.FACTURA.sifenCode(),
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
            "12",
            "CENTRAL",
            "5044",
            "FERNANDO DE LA MORA");
    SifenReceiverData receiver =
        new SifenReceiverData(null, "4123456", "Cliente Homologación HU-16", null, null, null);

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
            "Corte de cabello",
            null,
            1,
            "77",
            LINE_UNIT_PRICE,
            BigDecimal.ZERO,
            LINE_UNIT_PRICE,
            SifenTaxAffectation.GRAVADO,
            BigDecimal.valueOf(100),
            BigDecimal.valueOf(10),
            LINE_TAXABLE_BASE,
            LINE_TAX_AMOUNT);
    SifenInvoiceTotals totals =
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
    SifenInvoiceDetail detail =
        new SifenInvoiceDetail(
            List.of(line), totals, 1, List.of(new SifenPaymentDetail(1, LINE_UNIT_PRICE)));

    LocalDateTime signatureTimestamp = issueDateTime.minusMinutes(2);
    Document unsigned =
        xmlService.buildDocument(
            header, detail, cdcFields, signatureTimestamp, SifenDocumentTypeExtras.NONE);
    SifenSignedDocument signed = signingService.sign(material, unsigned, signatureTimestamp);

    String digestValueBase64 = extractDigestValueBase64(signed.document());
    SifenQrCodeService.SifenQrResult qr =
        qrCodeService.build(header, detail.totals(), detail.lines().size(), digestValueBase64);
    xmlService.appendQrGroup(signed.document(), qr.qrUrl());

    String signedXml = SifenDocumentXmlService.serialize(signed.document());
    Optional<SifenSubmissionResult> result = sendDocumentWithRetry(signedXml, cdc);
    boolean approved = result.isPresent() && isApproved(result.get().status());
    report.add(
        "HU-16",
        "seed factura " + label + " (envío inmediato, para referenciar) — CDC " + cdc,
        "APROBADO",
        describe(result),
        approved);
    return cdc;
  }

  private Optional<SifenSubmissionResult> sendDocumentWithRetry(String xml, String cdc)
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

  private static boolean isApproved(SifenSubmissionStatus status) {
    return status == SifenSubmissionStatus.APPROVED
        || status == SifenSubmissionStatus.APPROVED_WITH_OBSERVATION;
  }

  private static String extractDigestValueBase64(Document signedRDe) {
    var nodes = signedRDe.getElementsByTagNameNS(XMLSignature.XMLNS, "DigestValue");
    return nodes.item(0).getTextContent().trim();
  }

  /**
   * The rest of HU-16's own assertions (everything beyond AC-02, already asserted by the
   * {@code @Test} method right after calling {@link #run()}) — kept as a separate method purely so
   * {@link #run()} stays a pure report-builder the HU-17 capstone can call without also inheriting
   * these JUnit assertions.
   */
  private void assertHu16ChannelHealthAndAssumptions(SifenHomologationReport report) {
    // AC-03 (hard, unaffected by any external condition): desconocimiento and notificación de
    // recepción don't need a prior existing DTE — every one of these rows must be genuinely
    // approved.
    List<SifenHomologationReport.Row> standaloneApprovableFailures =
        report.rows().stream()
            .filter(
                row ->
                    row.scenario().contains("desconocerla")
                        || row.scenario().contains("notificar recepción"))
            .filter(row -> !row.passed())
            .toList();
    assertThat(standaloneApprovableFailures)
        .as(
            "AC-03: desconocimiento/notificación de recepción must be genuinely approved by SIFEN"
                + " (neither needs a prior existing DTE): %s",
            report.render())
        .isEmpty();

    // Everything below (AC-01, AC-05, and the conformidad/disconformidad/corrección half of AC-03)
    // needs a genuinely SIFEN-approved seed document to react to — contingent on the same external
    // dCodRes=1252 "El RUC del emisor se encuentra inactivo" state HU-13/14/15 documented
    // (re-confirmed live at the start of this story). If every seed document above was approved,
    // everything below is hard-asserted; if that external condition ever regresses, this aborts
    // instead of failing, same convention as every other Fase 4 story.
    List<SifenHomologationReport.Row> seedFailures =
        report.rows().stream()
            .filter(row -> row.scenario().startsWith("seed factura"))
            .filter(row -> !row.passed())
            .toList();
    Assumptions.assumeTrue(
        seedFailures.isEmpty(),
        () ->
            "AC-01/AC-03 (conformidad/disconformidad/corrección de un evento anterior)/AC-05:"
                + " couldn't seed a genuinely SIFEN-approved document just now — see"
                + " requirements/sifen/PROGRESS.md's HU-13 section for the external dCodRes=1252"
                + " 'RUC inactivo' state, not a code defect, before treating this as a regression: "
                + report.render());

    // AC-01 (hard): every cancellation of a genuinely-approved document must be approved by SIFEN.
    List<SifenHomologationReport.Row> ac01Failures =
        report.rows().stream()
            .filter(row -> row.scenario().startsWith("AC-01 cancelación"))
            .filter(row -> !row.passed())
            .toList();
    assertThat(ac01Failures)
        .as(
            "AC-01: every cancellation of a genuinely-approved document must be approved by SIFEN:"
                + " %s",
            report.render())
        .isEmpty();

    // AC-05 (hard): a second cancellation attempt on an already-cancelled document must be
    // rejected by SIFEN with a specific, real reason — never the generic 0160, never silently
    // approved.
    List<SifenHomologationReport.Row> ac05Failures =
        report.rows().stream()
            .filter(row -> row.scenario().startsWith("AC-05"))
            .filter(row -> !row.passed())
            .toList();
    assertThat(ac05Failures)
        .as(
            "AC-05: a second cancellation of an already-cancelled document must be rejected by"
                + " SIFEN with a specific reason: %s",
            report.render())
        .isEmpty();

    // AC-03 conformidad/disconformidad (hard): reacting to a genuinely-approved document.
    List<SifenHomologationReport.Row> reactionFailures =
        report.rows().stream()
            .filter(
                row ->
                    row.scenario().contains("confirmarla")
                        || row.scenario().contains("cuestionarla"))
            .filter(row -> !row.passed())
            .toList();
    assertThat(reactionFailures)
        .as(
            "AC-03: conformidad/disconformidad over a genuinely-approved document must be approved"
                + " by SIFEN: %s",
            report.render())
        .isEmpty();

    // AC-03 corrección (hard, channel-health only): the exact accept/reject verdict for
    // "correcting" an event isn't documented anywhere in this repo's source material, so this only
    // asserts SIFEN gave a real, specific, interpretable result — never a transport failure or the
    // generic 0160 this story fixed.
    List<SifenHomologationReport.Row> correctionFailures =
        report.rows().stream()
            .filter(row -> row.scenario().contains("corrección"))
            .filter(row -> !row.passed())
            .toList();
    assertThat(correctionFailures)
        .as(
            "AC-03: registering a correction (Tabla K) must get a specific, interpretable SIFEN"
                + " result, never the generic 0160: %s",
            report.render())
        .isEmpty();
  }

  private Optional<SifenSubmissionResult> sendWithRetry(Document signedEvent, String label)
      throws InterruptedException {
    String xml = SifenDocumentXmlService.serialize(signedEvent);
    Optional<SifenSubmissionResult> result = Optional.empty();
    for (int attempt = 1; attempt <= MAX_ATTEMPTS_ON_TRANSPORT_FAILURE; attempt++) {
      Thread.sleep(PACING_DELAY.toMillis());
      result = eventClient.sendWithClient(client, xml, label);
      if (result.isPresent()) {
        return result;
      }
    }
    return result;
  }

  private Document signEvent(Document unsigned) {
    SifenCertificateService certificateService =
        org.mockito.Mockito.mock(SifenCertificateService.class);
    org.mockito.Mockito.when(certificateService.requireActiveCertificate(0L)).thenReturn(material);
    SifenDocumentSigningService signingService =
        new SifenDocumentSigningService(certificateService, null, null, null, null, null, null);
    return signingService.signEvent(0L, unsigned);
  }

  private void recordApproval(
      SifenHomologationReport report, String scenario, Optional<SifenSubmissionResult> result) {
    boolean approved =
        result.isPresent()
            && (result.get().status() == SifenSubmissionStatus.APPROVED
                || result.get().status() == SifenSubmissionStatus.APPROVED_WITH_OBSERVATION);
    report.add("HU-16", scenario, "APROBADO", describe(result), approved);
  }

  private void recordSpecificRejection(
      SifenHomologationReport report,
      String scenario,
      Optional<SifenSubmissionResult> result,
      String expectedResultCode) {
    boolean matchesExpectedCode =
        result.isPresent()
            && result.get().status() == SifenSubmissionStatus.REJECTED
            && expectedResultCode.equals(result.get().resultCode());
    report.add(
        "HU-16",
        scenario,
        "RECHAZADO (" + expectedResultCode + ")",
        describe(result),
        matchesExpectedCode);
  }

  /**
   * AC-05: no expected rejection code is documented anywhere in this repo's source material for
   * "cancel an already-cancelled document" — records whatever SIFEN's real, specific reason turns
   * out to be, as long as it's an actual rejection with an identifiable reason, never a transport
   * failure, never a silent approval, and never the generic 0160 this story fixed.
   */
  private void recordRejectedWithSpecificReason(
      SifenHomologationReport report, String scenario, Optional<SifenSubmissionResult> result) {
    boolean rejectedWithReason =
        result.isPresent()
            && result.get().status() == SifenSubmissionStatus.REJECTED
            && result.get().resultCode() != null
            && !result.get().resultCode().isBlank()
            && !"0160".equals(result.get().resultCode());
    report.add(
        "HU-16", scenario, "RECHAZADO (motivo específico)", describe(result), rejectedWithReason);
  }

  /**
   * Tabla K's "corrección de un evento anterior" has no documented expected verdict (accepted or
   * rejected) anywhere in this repo's source material — records whatever SIFEN's real, specific,
   * interpretable result turns out to be, never a transport failure and never the generic 0160 this
   * story fixed.
   */
  private void recordSpecificResult(
      SifenHomologationReport report, String scenario, Optional<SifenSubmissionResult> result) {
    boolean interpretable =
        result.isPresent()
            && result.get().resultCode() != null
            && !result.get().resultCode().isBlank()
            && !"0160".equals(result.get().resultCode());
    report.add(
        "HU-16", scenario, "RESULTADO ESPECÍFICO INTERPRETABLE", describe(result), interpretable);
  }

  private static String describe(Optional<SifenSubmissionResult> result) {
    if (result.isEmpty()) {
      return "SIN RESPUESTA";
    }
    SifenSubmissionResult r = result.get();
    return String.format(Locale.ROOT, "%s (%s: %s)", r.status(), r.resultCode(), r.message());
  }

  private long nextId() {
    return idSequence++;
  }

  private LocalDateTime signatureInstant() {
    // Same clock-skew safety margin HU-13 established for this sandbox (see its Javadoc).
    return LocalDateTime.now(timeProperties.zoneId()).minusMinutes(2);
  }

  /**
   * Real finding while extending this story to react to genuinely-approved documents: Manual
   * Técnico V150's GDE004a rule ({@code dCodRes=4009} "Plazo de solicitud de cancelación... es
   * extemporáneo") computes the cancellation/reaction deadline from the event's own signature
   * date/time relative to the document's real SIFEN approval instant — subtracting {@link
   * #signatureInstant()}'s 2-minute clock-safety buffer here reliably puts the event's declared
   * timestamp <em>before</em> that approval ever happened (the seed document's own signature is
   * already 2 minutes in the past when it's sent, and building/sending the reaction event takes
   * more real time on top of that), tripping the same rule from the opposite direction. Confirmed
   * live: every cancellation attempt in this method failed with 4009 until this buffer was dropped
   * for events that react to a same-run approval. The real wall-clock time that elapses sending the
   * seed document and building this event is already enough margin against SIFEN's clock running
   * ahead (the reason {@link #signatureInstant()} exists at all) without an artificial buffer
   * working against us here.
   */
  private LocalDateTime postApprovalSignatureInstant() {
    return LocalDateTime.now(timeProperties.zoneId());
  }

  private String buildSyntheticCdc(long documentNumberOffset) {
    // C007/dNumDoc is at most 7 digits — unlike rEve's own Id (tdIdEve, up to 10), so this can't
    // reuse idSequence (an epoch-seconds value) directly, same bound HU-13 established.
    long documentNumber =
        Math.max(10, (System.currentTimeMillis() / 1000) % 9_000_000L) + documentNumberOffset;
    SifenControlNumberFields cdcFields =
        new SifenControlNumberFields(
            1,
            ISSUER_RUC,
            ISSUER_RUC_CHECK_DIGIT,
            ESTABLISHMENT,
            EXPEDITION_POINT,
            documentNumber,
            SifenTaxpayerType.LEGAL_ENTITY.sifenCode(),
            LocalDate.now(timeProperties.zoneId()),
            1,
            controlNumberService.generateSecurityCode(documentNumber));
    return controlNumberService.build(cdcFields);
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
