package com.cursorpoc.backend.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.cursorpoc.backend.config.SifenConnectionProperties;
import com.cursorpoc.backend.service.SifenServiceConnectivityChecker.CheckResult;
import com.cursorpoc.backend.service.SifenServiceConnectivityChecker.Outcome;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/**
 * HU-12 (EP-05): the actual homologation-grade proof AC-01/02/03/04 ask for — connects to all 7
 * named services (6 distinct WSDL endpoints, see {@link SifenHomologationEndpoint}'s Javadoc for
 * why two of the 7 collapse onto one) with both a real, PSC-issued certificate and a self-signed
 * one, against the real {@code sifen-test.set.gov.py}, and prints/asserts on a {@link
 * SifenHomologationReport}.
 *
 * <p><b>Guarded, not throwaway — unlike Fases 1-3's live-verification tests</b> (each one written,
 * run once, then deleted before its commit, per PROGRESS.md's "ThrowawayLiveSifenHuNN" pattern):
 * this story's entire purpose (per its own AC-04, and EP-05's mandate to demonstrate homologation
 * compliance to the DNIT) is a reproducible real report, so it stays in the suite as a normal JUnit
 * test. It never runs in CI or on a clean checkout, though: the pilot {@code .p12} and its password
 * are gitignored (see {@code requirements/sifen/.gitignore}) for the same reason HU-05 documented
 * for its own live verification — real credentials never belong in the repo or in CI. {@link
 * Assumptions#assumeTrue} skips (marks "aborted", not failed) whenever those files aren't present
 * locally, exactly like every other environment in this codebase that quietly lacks them.
 *
 * <p>To re-run for real: have {@code requirements/sifen/*.p12} and {@code
 * requirements/sifen/.secrets/lucia-cert-password.txt} present (see PROGRESS.md's HU-05 section for
 * how to obtain them), then run this test directly, e.g. {@code ./gradlew test --tests
 * "*SifenHomologationConnectivityLiveTest*" --no-daemon}, and read the report on stdout/log output.
 *
 * <p><b>Real-server finding (2026-07-28): the SIFEN test gateway drops connections when hit with 14
 * mTLS handshakes back to back in under 2 seconds</b> — first observed as this very test failing
 * with {@code IOException: HTTP/1.1 header parser received no bytes} on several endpoints, never a
 * real {@code 200}/{@code 302} response. Reproduced manually with plain {@code curl}: the exact
 * same request that fails when fired immediately after a dozen others succeeds instantly once given
 * room to breathe (a few hundred ms, or simply being one of only 1-3 requests in a short window).
 * This is gateway-side connection throttling, not a certificate rejection — {@link
 * #PACING_DELAY}/{@link #checkWithRetry} exist purely to keep this test from reporting a false
 * "REJECTED" for a valid certificate because of that unrelated infrastructure behavior, never to
 * paper over a genuine AC-02/AC-03 mismatch (a real HTTP response, even a wrong one, is never
 * retried — see {@link #checkWithRetry}).
 */
class SifenHomologationConnectivityLiveTest {

  private static final String INVALID_CERT_CLASSPATH_RESOURCE = "sifen/test-cert.p12";
  private static final String INVALID_CERT_PASSWORD = "TestPass123!";

  /** Spacing between successive real requests — see the class Javadoc's "Real-server finding". */
  private static final Duration PACING_DELAY = Duration.ofMillis(500);

  private static final int MAX_ATTEMPTS_ON_TRANSPORT_FAILURE = 3;

  @Test
  void allSevenNamedServices_acceptRealPilotCertificate_andRejectASelfSignedOne() throws Exception {
    Path pilotCertificate = SifenPilotCertificateTestSupport.findPilotCertificate();
    Path pilotPassword = SifenPilotCertificateTestSupport.findPilotPassword();
    Assumptions.assumeTrue(
        pilotCertificate != null && pilotPassword != null,
        "Pilot .p12/password not present in this checkout (gitignored, see requirements/sifen/"
            + ".gitignore) — skipping the real SIFEN homologation connectivity check. See HU-05/"
            + "HU-12 in requirements/sifen/PROGRESS.md to obtain them locally.");

    String password = Files.readString(pilotPassword).trim();
    KeyStore validKeyStore =
        SifenPilotCertificateTestSupport.loadKeyStore(
            Files.readAllBytes(pilotCertificate), password);
    KeyStore invalidKeyStore =
        SifenPilotCertificateTestSupport.loadKeyStore(
            readClasspathResource(INVALID_CERT_CLASSPATH_RESOURCE), INVALID_CERT_PASSWORD);

    var checker = new SifenServiceConnectivityChecker(new SifenConnectionProperties());
    var report = new SifenHomologationReport();

    for (SifenHomologationEndpoint endpoint : SifenHomologationEndpoint.values()) {
      CheckResult validResult =
          checkWithRetry(checker, endpoint, validKeyStore, password, Outcome.ACCEPTED);
      report.add(
          "HU-12",
          endpoint.displayName() + " — certificado válido",
          Outcome.ACCEPTED.name(),
          describeActual(validResult),
          validResult.matchesExpectation());

      CheckResult invalidResult =
          checkWithRetry(
              checker, endpoint, invalidKeyStore, INVALID_CERT_PASSWORD, Outcome.REJECTED);
      report.add(
          "HU-12",
          endpoint.displayName() + " — certificado inválido",
          Outcome.REJECTED.name(),
          describeActual(invalidResult),
          invalidResult.matchesExpectation());
    }

    System.out.println(report.render());

    List<SifenHomologationReport.Row> failures =
        report.rows().stream().filter(row -> !row.passed()).toList();
    assertThat(failures)
        .as("Every AC-02/AC-03 expectation must hold for all 7 named services: %s", report.render())
        .isEmpty();
  }

  /**
   * Paces every real request (see class Javadoc) and, only when a request got no interpretable HTTP
   * response at all ({@code httpStatus() == -1}, i.e. a transport/TLS-level {@link IOException},
   * not a real {@code 200}/{@code 302}), retries up to {@link #MAX_ATTEMPTS_ON_TRANSPORT_FAILURE}
   * times. A genuine HTTP response — even one that mismatches {@code expected} — is returned
   * immediately, never retried: retrying those would risk masking a real AC-02/AC-03 failure as a
   * fluke.
   */
  private static CheckResult checkWithRetry(
      SifenServiceConnectivityChecker checker,
      SifenHomologationEndpoint endpoint,
      KeyStore keyStore,
      String password,
      Outcome expected)
      throws InterruptedException {
    CheckResult result = null;
    for (int attempt = 1; attempt <= MAX_ATTEMPTS_ON_TRANSPORT_FAILURE; attempt++) {
      Thread.sleep(PACING_DELAY.toMillis());
      result = checker.check(endpoint, keyStore, password, expected);
      if (result.httpStatus() != -1) {
        return result;
      }
    }
    return result;
  }

  private static String describeActual(CheckResult result) {
    return String.format(Locale.ROOT, "%s (HTTP %d)", result.actual(), result.httpStatus());
  }

  private static byte[] readClasspathResource(String resourcePath) throws IOException {
    return Files.readAllBytes(
        Path.of(
            SifenHomologationConnectivityLiveTest.class
                .getClassLoader()
                .getResource(resourcePath)
                .getPath()));
  }
}
