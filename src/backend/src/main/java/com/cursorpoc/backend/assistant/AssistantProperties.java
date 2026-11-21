package com.cursorpoc.backend.assistant;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Conversational assistant settings ({@code app.femme.assistant.*}, requirements/asistente).
 *
 * <p>{@code model=real} talks to the Azure AI Foundry deployment ({@code endpoint}/{@code
 * deployment}, Entra ID — no API key); {@code model=fake} swaps in the scripted double used by the
 * {@code e2e} and {@code test} profiles.
 */
@ConfigurationProperties(prefix = "app.femme.assistant")
public class AssistantProperties {

  /** {@code real} (Foundry) or {@code fake} (scripted model, e2e/tests). */
  private String model = "real";

  /** Foundry endpoint, e.g. {@code https://femme-foundry-xxxx.cognitiveservices.azure.com/}. */
  private String endpoint = "";

  /** Name of the model deployment inside the Foundry account. */
  private String deployment = "";

  /** Last USER/ASSISTANT messages of the conversation sent to the model as context. */
  private int historyMaxMessages = 20;

  /** Max model↔tool round trips for one user message (guards against tool loops). */
  private int maxToolIterations = 4;

  /** Upper bound on a whole model request (all tool round trips). */
  private int requestTimeoutSeconds = 90;

  /** Completion token cap (includes reasoning tokens on reasoning models). */
  private int maxCompletionTokens = 4000;

  /** Max characters of a user message. */
  private int maxMessageChars = 2000;

  /** Conversations idle for longer than this are deleted (AssistantRetentionJob). */
  private int conversationRetentionDays = 30;

  /**
   * Pause (ms) after announcing a tool as running and before running it. 0 in production; the e2e
   * profile raises it so Playwright can observe the «Buscando clientes…» indicator.
   */
  private int toolDelayMs = 0;

  public String getModel() {
    return model;
  }

  public void setModel(String model) {
    this.model = model;
  }

  public String getEndpoint() {
    return endpoint;
  }

  public void setEndpoint(String endpoint) {
    this.endpoint = endpoint;
  }

  public String getDeployment() {
    return deployment;
  }

  public void setDeployment(String deployment) {
    this.deployment = deployment;
  }

  public int getHistoryMaxMessages() {
    return historyMaxMessages;
  }

  public void setHistoryMaxMessages(int historyMaxMessages) {
    this.historyMaxMessages = historyMaxMessages;
  }

  public int getMaxToolIterations() {
    return maxToolIterations;
  }

  public void setMaxToolIterations(int maxToolIterations) {
    this.maxToolIterations = maxToolIterations;
  }

  public int getRequestTimeoutSeconds() {
    return requestTimeoutSeconds;
  }

  public void setRequestTimeoutSeconds(int requestTimeoutSeconds) {
    this.requestTimeoutSeconds = requestTimeoutSeconds;
  }

  public int getMaxCompletionTokens() {
    return maxCompletionTokens;
  }

  public void setMaxCompletionTokens(int maxCompletionTokens) {
    this.maxCompletionTokens = maxCompletionTokens;
  }

  public int getMaxMessageChars() {
    return maxMessageChars;
  }

  public void setMaxMessageChars(int maxMessageChars) {
    this.maxMessageChars = maxMessageChars;
  }

  public int getConversationRetentionDays() {
    return conversationRetentionDays;
  }

  public void setConversationRetentionDays(int conversationRetentionDays) {
    this.conversationRetentionDays = conversationRetentionDays;
  }

  public int getToolDelayMs() {
    return toolDelayMs;
  }

  public void setToolDelayMs(int toolDelayMs) {
    this.toolDelayMs = toolDelayMs;
  }
}
