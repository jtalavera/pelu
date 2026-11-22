package com.cursorpoc.backend.assistant;

import com.azure.core.credential.TokenRequestContext;
import com.azure.identity.DefaultAzureCredentialBuilder;
import java.net.http.HttpClient;
import java.time.Duration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.stereotype.Component;

/**
 * The {@link SpeechTokenProvider}: the real one (Azure, Entra ID) with the real model, and a fake
 * one with the scripted model (e2e/test profiles), exactly like {@link AssistantModelClient}.
 */
@Configuration
public class SpeechTokenConfig {

  private static final String SCOPE = "https://cognitiveservices.azure.com/.default";

  @Bean
  @ConditionalOnProperty(
      name = "app.femme.assistant.model",
      havingValue = "real",
      matchIfMissing = true)
  SpeechTokenProvider azureSpeechTokenProvider(AssistantProperties props) {
    // Credential built lazily: a backend without Azure access still boots.
    var credential = new Lazy<>(() -> new DefaultAzureCredentialBuilder().build());
    return new AzureSpeechTokenService(
        props.getEndpoint(),
        props.getSpeechRegion(),
        () -> credential.get().getTokenSync(new TokenRequestContext().addScopes(SCOPE)).getToken(),
        HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build());
  }

  /**
   * Dictation is simulated in e2e (a transcript is injected): this token is never used for audio.
   */
  @Component
  @ConditionalOnProperty(name = "app.femme.assistant.model", havingValue = "fake")
  static class FakeSpeechTokenProvider implements SpeechTokenProvider {
    @Override
    public SpeechToken issue() {
      return new SpeechToken(
          "fake-speech-token", "test", AzureSpeechTokenService.EXPIRES_IN_SECONDS);
    }
  }

  private static final class Lazy<T> {
    private final java.util.function.Supplier<T> supplier;
    private volatile T value;

    Lazy(java.util.function.Supplier<T> supplier) {
      this.supplier = supplier;
    }

    T get() {
      T v = value;
      if (v == null) {
        synchronized (this) {
          v = value;
          if (v == null) {
            v = supplier.get();
            value = v;
          }
        }
      }
      return v;
    }
  }
}
