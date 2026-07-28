package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.http.HttpClient;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.util.List;
import java.util.Locale;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/**
 * HU-17 AC-05, the actual DNIT-facing deliverable of Fase 4 ("Homologación ante la DNIT"): folds
 * every EP-05 story's live homologation report (HU-12 through HU-17) into a <b>single</b>
 * consolidated {@link SifenHomologationReport}, via {@link SifenHomologationReport#combinedWith} —
 * the seam HU-12 opened for exactly this purpose and every story since HU-13 extended without ever
 * exercising.
 *
 * <p><b>Why this re-runs every story's live scenarios instead of reading state left behind by their
 * own {@code @Test} methods:</b> each of HU-12 through HU-17's live test classes builds its {@link
 * SifenHomologationReport} as a local variable inside its own {@code @Test} method — nothing is
 * persisted across separate JUnit test classes in a JVM run (there's no shared suite state to
 * read), and this codebase deliberately keeps {@link SifenHomologationReport} without any
 * persistence (see its own Javadoc: "no persistence, no HTTP endpoint"). The only way to genuinely
 * consolidate real results into one report, rather than transcribing 6 classes' separately-rendered
 * outputs by hand, is for one process to call each story's own send/build/assert-free {@code
 * run(...)} method (each extracted by this story for exactly this reason — see their Javadocs) and
 * combine the results.
 *
 * <p><b>Operational note:</b> running this test sends every real request HU-12 through HU-17's own
 * live tests already send, a second time, against {@code sifen-test.set.gov.py} — roughly doubling
 * this checkout's real network traffic against SIFEN's sandbox for one full run of {@code ./gradlew
 * test} with the pilot {@code .p12} present. This is deliberate: HU-12's own "Real-server finding"
 * (the sandbox throttles rapid connections) is already mitigated by the pacing/retry discipline
 * every extracted {@code run(...)} method inherits unchanged from its original {@code @Test}
 * method. This test is not meant to run routinely — like every other Fase 4 live test, it's gated
 * by {@link Assumptions#assumeTrue} on the gitignored pilot certificate, so it never runs in CI or
 * on a clean checkout; it exists to be run deliberately, once, to produce the artifact the DNIT
 * actually needs to see.
 *
 * <p><b>Scope decision:</b> this test does not re-assert every fine-grained scenario each
 * contributing story already hard-asserts in its own {@code @Test} method (those still run
 * independently in the same {@code ./gradlew test} invocation and fail the build on their own if
 * they regress). This test's own assertions only confirm the consolidation itself is genuine —
 * every story actually contributed rows, none silently dropped — and print the single final report
 * plus a per-story pass/fail summary, which is what AC-05 actually asks for.
 */
class SifenHomologationFinalReportTest {

  private static final List<String> EXPECTED_STORIES =
      List.of("HU-12", "HU-13", "HU-14", "HU-15", "HU-16", "HU-17");

  @Test
  void allEp05StoriesConsolidateIntoOneFinalHomologationReport() throws Exception {
    Path pilotCertificate = SifenPilotCertificateTestSupport.findPilotCertificate();
    Path pilotPassword = SifenPilotCertificateTestSupport.findPilotPassword();
    Assumptions.assumeTrue(
        pilotCertificate != null && pilotPassword != null,
        "Pilot .p12/password not present in this checkout (gitignored, see requirements/sifen/"
            + ".gitignore) — skipping the HU-17 AC-05 consolidated report. See HU-05/HU-12 in"
            + " requirements/sifen/PROGRESS.md to obtain them locally.");

    String password = Files.readString(pilotPassword).trim();
    KeyStore keyStore =
        SifenPilotCertificateTestSupport.loadKeyStore(
            Files.readAllBytes(pilotCertificate), password);
    KeyStore invalidKeyStore = SifenHomologationConnectivityLiveTest.loadInvalidKeyStore();
    SifenActiveCertificateMaterial material = loadMaterial(keyStore, password);
    HttpClient mtlsClient = SifenConnectionService.buildMutualTlsClient(keyStore, password, null);
    HttpClient plainClient = HttpClient.newHttpClient();

    SifenHomologationReport hu12 =
        new SifenHomologationConnectivityLiveTest().run(keyStore, password, invalidKeyStore);
    SifenHomologationReport hu13 =
        new SifenHomologationInvoiceSubmissionLiveTest().run(material, mtlsClient);
    SifenHomologationReport hu14 =
        new SifenHomologationOtherDocumentTypesLiveTest().run(material, mtlsClient);
    SifenHomologationReport hu15 =
        new SifenHomologationBatchSubmissionLiveTest().run(material, mtlsClient);
    SifenHomologationReport hu16 = new SifenHomologationEventsLiveTest().run(material, mtlsClient);
    SifenHomologationReport hu17 =
        new SifenHomologationDocumentQueryAndKudeLiveTest().run(material, mtlsClient, plainClient);

    SifenHomologationReport finalReport = hu12.combinedWith(hu13, hu14, hu15, hu16, hu17);

    System.out.println("=== REPORTE FINAL CONSOLIDADO — EP-05 Homologación ante la DNIT ===");
    System.out.println(finalReport.render());
    System.out.println(renderStorySummary(finalReport));

    // AC-05's structural guarantee: the consolidation is genuine — every EP-05 story contributed
    // at least one row, none silently dropped by a wiring mistake.
    for (String story : EXPECTED_STORIES) {
      assertThat(finalReport.rows().stream().anyMatch(row -> row.story().equals(story)))
          .as(
              "The final consolidated report must include rows from %s: %s",
              story, EXPECTED_STORIES)
          .isTrue();
    }
  }

  private static String renderStorySummary(SifenHomologationReport report) {
    StringBuilder sb = new StringBuilder();
    sb.append(String.format("%-8s | %-10s | %-10s%n", "Historia", "Pasaron", "Total"));
    for (String story : EXPECTED_STORIES) {
      long total = report.rows().stream().filter(row -> row.story().equals(story)).count();
      long passed =
          report.rows().stream().filter(row -> row.story().equals(story) && row.passed()).count();
      sb.append(String.format(Locale.ROOT, "%-8s | %-10d | %-10d%n", story, passed, total));
    }
    return sb.toString();
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
