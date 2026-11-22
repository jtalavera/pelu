package com.cursorpoc.backend.assistant;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Exchanges the backend's own Entra ID identity (Managed Identity in Azure, {@code az login}
 * locally) for a Speech-only token at the Foundry account's {@code /sts/v1.0/issueToken}. The Entra
 * token itself — which would also open the model deployment — never leaves the backend.
 *
 * <p>The issued token lasts 10 minutes; the browser is told 9 so it renews before it expires. The
 * token is never logged.
 *
 * <p>The token is kept for a few minutes and handed to every caller: asking Azure on each dictation
 * (an Entra token plus a round trip to {@code issueToken}) is what made the microphone slow to
 * start. It is a Speech-only token that carries no tenant or user data, and every request to the
 * endpoint is still authenticated and flag-checked before reaching this service. Each caller is
 * told how much time the token has <em>left</em>, never the full 9 minutes.
 */
public class AzureSpeechTokenService implements SpeechTokenProvider {

  private static final Logger log = LoggerFactory.getLogger(AzureSpeechTokenService.class);

  /** Azure issues 10-minute tokens; one minute of margin for clock skew and network. */
  static final int EXPIRES_IN_SECONDS = 540;

  private final String endpoint;
  private final String region;
  private final Supplier<String> entraToken;

  /**
   * A cached token is only handed out while at least this long is left, so the browser can listen
   * for its 2-minute maximum (plus margin) with it.
   */
  static final Duration MIN_REMAINING = Duration.ofMinutes(4);

  private final HttpClient http;
  private final Clock clock;
  private SpeechToken cached;
  private Instant cachedExpiresAt = Instant.EPOCH;

  /**
   * @param endpoint the Foundry account endpoint ({@code
   *     https://<name>.cognitiveservices.azure.com/})
   * @param region Speech region handed to the browser (e.g. {@code centralus})
   * @param entraToken supplies a fresh Entra ID access token for {@code
   *     cognitiveservices.azure.com}
   */
  public AzureSpeechTokenService(
      String endpoint, String region, Supplier<String> entraToken, HttpClient http) {
    this(endpoint, region, entraToken, http, Clock.systemUTC());
  }

  AzureSpeechTokenService(
      String endpoint, String region, Supplier<String> entraToken, HttpClient http, Clock clock) {
    this.clock = clock;
    this.endpoint = endpoint == null ? "" : endpoint.trim();
    this.region = region == null ? "" : region.trim();
    this.entraToken = entraToken;
    this.http = http;
  }

  @Override
  public synchronized SpeechToken issue() {
    if (endpoint.isEmpty() || region.isEmpty()) {
      throw new SpeechUnavailableException(
          "speech not configured (FEMME_AI_ENDPOINT / FEMME_SPEECH_REGION)");
    }
    Instant now = clock.instant();
    if (cached != null && Duration.between(now, cachedExpiresAt).compareTo(MIN_REMAINING) >= 0) {
      return new SpeechToken(
          cached.token(),
          cached.region(),
          (int) Duration.between(now, cachedExpiresAt).toSeconds());
    }
    SpeechToken fresh = requestToken();
    cached = fresh;
    cachedExpiresAt = now.plusSeconds(fresh.expiresInSeconds());
    return fresh;
  }

  private SpeechToken requestToken() {
    String base = endpoint.endsWith("/") ? endpoint : endpoint + "/";
    try {
      HttpRequest request =
          HttpRequest.newBuilder(URI.create(base + "sts/v1.0/issueToken"))
              .timeout(Duration.ofSeconds(10))
              .header("Authorization", "Bearer " + entraToken.get())
              .POST(HttpRequest.BodyPublishers.noBody())
              .build();
      HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
      if (response.statusCode() != 200 || response.body() == null || response.body().isBlank()) {
        // Status only: the body of an auth failure must not end up in logs.
        throw new SpeechUnavailableException("issueToken answered " + response.statusCode());
      }
      return new SpeechToken(response.body().trim(), region, EXPIRES_IN_SECONDS);
    } catch (IOException e) {
      throw new SpeechUnavailableException("issueToken failed: " + e.getClass().getSimpleName(), e);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new SpeechUnavailableException("issueToken interrupted", e);
    } catch (SpeechUnavailableException e) {
      throw e;
    } catch (RuntimeException e) {
      // Credential problems (not logged in, no role…) or a malformed endpoint.
      log.error("speech token could not be issued: {}", e.getClass().getSimpleName());
      throw new SpeechUnavailableException("speech token unavailable", e);
    }
  }
}
