package com.cursorpoc.backend.service;

import com.cursorpoc.backend.config.SifenConnectionProperties;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * HU-12 (EP-05, homologación): a generic connectivity check reused across all 7 named services in
 * {@link SifenHomologationEndpoint} — AC-01/AC-02/AC-03 only need "does an authenticated mTLS
 * request reach this WSDL and get accepted/rejected", not each service's actual business
 * request/response schema (that's HU-14/HU-15/HU-16/HU-17's job, as each one needs it).
 *
 * <p>Deliberately takes a {@link KeyStore} + password directly rather than a tenant id — unlike
 * {@link SifenConnectionService#connect(long)}, homologation isn't scoped to a single tenant's
 * active certificate (HU-21); it needs to run the very same check with two different, unrelated
 * certificates (the real pilot one and a self-signed fixture) to prove both AC-02 (accepted) and
 * AC-03 (rejected). Reuses {@link SifenConnectionService}'s own mTLS plumbing ({@link
 * SifenConnectionService#buildMutualTlsClient}) rather than duplicating it — same classification
 * rule verified live by HU-05: HTTP 200 means the connection was accepted, anything else (including
 * a transport/TLS exception) is a rejection.
 */
@Service
public class SifenServiceConnectivityChecker {

  private static final Logger log = LoggerFactory.getLogger(SifenServiceConnectivityChecker.class);

  private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(10);

  /** AC-02/AC-03: the only two outcomes a connectivity check can classify. */
  public enum Outcome {
    ACCEPTED,
    REJECTED
  }

  /**
   * AC-04: expected vs. actual, per service — the row shape {@link SifenHomologationReport} logs.
   */
  public record CheckResult(
      SifenHomologationEndpoint endpoint, Outcome expected, Outcome actual, int httpStatus) {

    public boolean matchesExpectation() {
      return expected == actual;
    }
  }

  private final SifenConnectionProperties connectionProperties;

  public SifenServiceConnectivityChecker(SifenConnectionProperties connectionProperties) {
    this.connectionProperties = connectionProperties;
  }

  public CheckResult check(
      SifenHomologationEndpoint endpoint,
      KeyStore keyStore,
      String keystorePassword,
      Outcome expected) {
    return check(endpoint, keyStore, keystorePassword, expected, null);
  }

  /**
   * Package-private overload letting tests point TLS trust at a local mock server's certificate
   * instead of the JVM's default CA trust store — same rationale as {@link
   * SifenConnectionService#connect(long, javax.net.ssl.TrustManager[])}.
   */
  CheckResult check(
      SifenHomologationEndpoint endpoint,
      KeyStore keyStore,
      String keystorePassword,
      Outcome expected,
      javax.net.ssl.TrustManager[] testTrustManagers) {
    try {
      HttpClient client =
          SifenConnectionService.buildMutualTlsClient(
              keyStore, keystorePassword, testTrustManagers);
      HttpRequest request =
          HttpRequest.newBuilder(
                  URI.create(connectionProperties.activeBaseUrl() + endpoint.wsdlPath()))
              .timeout(CONNECT_TIMEOUT)
              .GET()
              .build();
      HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());

      Outcome actual = response.statusCode() == 200 ? Outcome.ACCEPTED : Outcome.REJECTED;
      log.info(
          "SIFEN homologation connectivity check endpoint={} expected={} actual={} httpStatus={}",
          endpoint,
          expected,
          actual,
          response.statusCode());
      return new CheckResult(endpoint, expected, actual, response.statusCode());
    } catch (IOException | InterruptedException | GeneralSecurityException e) {
      if (Thread.currentThread().isInterrupted()) {
        Thread.currentThread().interrupt();
      }
      log.error(
          "SIFEN homologation connectivity check failed endpoint={} expected={} error={}",
          endpoint,
          expected,
          e.toString());
      return new CheckResult(endpoint, expected, Outcome.REJECTED, -1);
    }
  }
}
