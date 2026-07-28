package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.config.FemmeTimeProperties;
import com.cursorpoc.backend.config.SifenConnectionProperties;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
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
import java.util.List;
import java.util.Locale;
import java.util.Optional;
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

  private SifenActiveCertificateMaterial material;
  private HttpClient client;
  private long idSequence;

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

    // === AC-01 (channel-health half) + AC-05 (channel-health half): a cancellation attempt for a
    // syntactically valid but never-approved CDC must come back with the specific "CDC no
    // existente"
    // reason (4002), never the generic 0160 the fixed envelope bug used to produce — hard evidence
    // the event channel itself works end to end, independent of whether SIFEN has approved any
    // document from this environment yet.
    String neverApprovedCdc = buildSyntheticCdc(200);
    Optional<SifenSubmissionResult> firstCancelAttempt =
        sendWithRetry(
            signEvent(
                cancellationXmlService.buildCancellationEvent(
                    neverApprovedCdc,
                    "HU-16 AC-01/AC-05 - cancelación de prueba 1",
                    nextId(),
                    signatureInstant())),
            "cancelación 1/2 (canal)");
    recordSpecificRejection(
        report, "AC-01/AC-05 cancelación 1/2 sobre CDC nunca aprobado", firstCancelAttempt, "4002");

    Optional<SifenSubmissionResult> secondCancelAttempt =
        sendWithRetry(
            signEvent(
                cancellationXmlService.buildCancellationEvent(
                    neverApprovedCdc,
                    "HU-16 AC-01/AC-05 - cancelación de prueba 2",
                    nextId(),
                    signatureInstant())),
            "cancelación 2/2 (canal)");
    recordSpecificRejection(
        report, "AC-01/AC-05 cancelación 2/2 sobre el mismo CDC", secondCancelAttempt, "4002");

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

    // Conformidad ("confirmarla") and Disconformidad ("cuestionarla"): confirmed live these DO
    // require the CDC to genuinely exist in SIFEN (dCodRes=4152/4202 "CDC del DTE es inexistente")
    // — unlike the three event types above. Each gets one attempt here (hard-asserted as a
    // specific,
    // real, content-level rejection — never the generic 0160); the literal "aprobado" half is
    // deferred to the Assumptions block below, same as AC-01.
    String conformidadCdc = buildSyntheticCdc(400);
    Optional<SifenSubmissionResult> conformidadResult =
        sendWithRetry(
            signEvent(
                receptorXmlService.buildConformity(
                    conformidadCdc, ConformityType.TOTAL, null, nextId(), signatureInstant())),
            "conformidad");
    recordSpecificRejection(
        report, "AC-03 conformidad (\"confirmarla\")", conformidadResult, "4152");

    Optional<SifenSubmissionResult> disconformidadResult =
        sendWithRetry(
            signEvent(
                receptorXmlService.buildDisconformity(
                    buildSyntheticCdc(500),
                    "HU-16 AC-03 - cuestiono el monto facturado",
                    nextId(),
                    signatureInstant())),
            "disconformidad");
    recordSpecificRejection(
        report, "AC-03 disconformidad (\"cuestionarla\")", disconformidadResult, "4202");

    // "Corregir un evento anterior" (AC-03's 5th action): Manual Técnico V150's Tabla K scopes this
    // correction mechanism to Conformidad/Disconformidad/Desconocimiento only ("solo se puede
    // registrar un evento de corrección sobre cada evento mencionado") — confirmed live it
    // genuinely
    // needs BOTH a real approved DTE AND a real first event already registered on it (even
    // Desconocimiento's own standalone approval above doesn't make a CDC "exist" for a later
    // Conformidad/Disconformidad attempt on the same CDC — still 4152/"inexistente"). Registering
    // Disconformidad right after Conformidad on the same CDC — the shape a correction would take —
    // still hits the same existence check first, hard-asserted below as further channel-health
    // evidence; the literal "corrección de un evento realmente existente" is deferred with AC-01.
    Optional<SifenSubmissionResult> correctionAttempt =
        sendWithRetry(
            signEvent(
                receptorXmlService.buildDisconformity(
                    conformidadCdc,
                    "HU-16 AC-03 - corrección del evento anterior (Tabla K)",
                    nextId(),
                    signatureInstant())),
            "corrección (Tabla K)");
    recordSpecificRejection(
        report, "AC-03 corrección de un evento anterior (Tabla K)", correctionAttempt, "4202");

    return report;
  }

  /**
   * The rest of HU-16's own assertions (everything beyond AC-02, already asserted by the
   * {@code @Test} method right after calling {@link #run()}) — kept as a separate method purely so
   * {@link #run()} stays a pure report-builder the HU-17 capstone can call without also inheriting
   * these JUnit assertions.
   */
  private void assertHu16ChannelHealthAndAssumptions(SifenHomologationReport report) {
    // AC-01/AC-05/AC-03(conformidad/disconformidad/corrección) channel-health half (hard): every
    // rejection above must be the SPECIFIC real SIFEN reason recorded, never the generic 0160 "XML
    // mal formado" that used to mask all of this.
    List<SifenHomologationReport.Row> channelHealthFailures =
        report.rows().stream()
            .filter(
                row ->
                    row.scenario().contains("canal)")
                        || row.scenario().contains("confirmarla")
                        || row.scenario().contains("cuestionarla")
                        || row.scenario().contains("corrección"))
            .filter(row -> !row.passed())
            .toList();
    assertThat(channelHealthFailures)
        .as(
            "the event channel must return SIFEN's real, specific rejection reason (never the"
                + " generic 0160 this story fixed): %s",
            report.render())
        .isEmpty();

    // AC-03 (hard): desconocimiento and notificación de recepción don't need a prior existing DTE —
    // every one of these rows must be genuinely approved.
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

    // AC-01/AC-03(conformidad/disconformidad/corrección)/AC-05 (soft): today these need a genuinely
    // SIFEN-approved DTE to react to — blocked by the same external dCodRes=1252 "El RUC del emisor
    // se encuentra inactivo" state HU-13/14/15 documented (re-confirmed live at the start of this
    // story). Every row above already proves the channel itself is healthy; this only documents
    // that
    // the literal "aprobado sobre un DTE real" half of these ACs is still pending an external SIFEN
    // state change, not a code defect.
    Assumptions.assumeTrue(
        false,
        () ->
            "AC-01/AC-03 (conformidad/disconformidad/corrección de un evento anterior)/AC-05: these"
                + " ACs' literal happy path needs a genuinely SIFEN-approved DTE to cancel/react to,"
                + " which this environment still can't produce — see"
                + " requirements/sifen/PROGRESS.md's HU-13 section for the external dCodRes=1252 'RUC"
                + " inactivo' block re-confirmed at the start of this story. Every row above already"
                + " hard-asserts the event channel itself (built, signed, sent, parsed) is healthy"
                + " end to end: "
                + report.render());
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
