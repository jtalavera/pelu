package com.cursorpoc.backend.assistant;

import com.azure.identity.DefaultAzureCredentialBuilder;
import java.time.Duration;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.ai.openai.setup.AzureOpenAiCredentials;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires the real {@link AssistantModelClient}. Hand-built (no Spring AI starter) because the model
 * authenticates with Entra ID — {@code DefaultAzureCredential}, i.e. the Container App's Managed
 * Identity in Azure and {@code az login} locally — and must not exist at all under the scripted
 * model profiles. Fails closed: a missing {@code app.femme.assistant.model} means the real model.
 */
@Configuration
@ConditionalOnProperty(
    name = "app.femme.assistant.model",
    havingValue = "real",
    matchIfMissing = true)
public class FoundryClientConfig {

  @Bean
  AssistantModelClient assistantModelClient(AssistantProperties props) {
    return new FoundryAssistantModelClient(
        () -> buildChatModel(props), props.getDeployment(), props.getMaxCompletionTokens());
  }

  static OpenAiChatModel buildChatModel(AssistantProperties props) {
    if (props.getEndpoint() == null
        || props.getEndpoint().isBlank()
        || props.getDeployment() == null
        || props.getDeployment().isBlank()) {
      throw new IllegalStateException(
          "app.femme.assistant.endpoint / deployment (FEMME_AI_ENDPOINT / FEMME_AI_DEPLOYMENT) are"
              + " not set");
    }
    OpenAiChatOptions options =
        OpenAiChatOptions.builder()
            .baseUrl(props.getEndpoint())
            .microsoftFoundry(true)
            .deploymentName(props.getDeployment())
            .model(props.getDeployment())
            .credential(AzureOpenAiCredentials.from(new DefaultAzureCredentialBuilder().build()))
            .timeout(Duration.ofSeconds(props.getRequestTimeoutSeconds()))
            .maxRetries(1)
            .build();
    return OpenAiChatModel.builder().options(options).build();
  }
}
