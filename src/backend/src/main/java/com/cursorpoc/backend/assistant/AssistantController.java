package com.cursorpoc.backend.assistant;

import com.cursorpoc.backend.assistant.AssistantConversationService.ConversationView;
import com.cursorpoc.backend.security.FemmeUserPrincipal;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import tools.jackson.databind.ObjectMapper;

/**
 * Conversational assistant API. Request/response logging (path, method, tenantId, status) comes
 * from {@code ApiEndpointLoggingFilter}; the conversation text is deliberately never logged.
 */
@RestController
@RequestMapping("/api/assistant")
public class AssistantController {

  private static final Logger log = LoggerFactory.getLogger(AssistantController.class);

  /** Grace period on top of the model timeout before the SSE connection itself is cut. */
  private static final long SSE_TIMEOUT_GRACE_MS = 15_000;

  private final AssistantAccess access;
  private final AssistantConversationService conversations;
  private final AssistantOrchestrator orchestrator;
  private final AssistantProperties properties;
  private final ExecutorService assistantExecutor;
  private final ObjectMapper objectMapper;
  private final SpeechTokenProvider speechTokens;

  public AssistantController(
      AssistantAccess access,
      AssistantConversationService conversations,
      AssistantOrchestrator orchestrator,
      AssistantProperties properties,
      ExecutorService assistantExecutor,
      ObjectMapper objectMapper,
      SpeechTokenProvider speechTokens) {
    this.access = access;
    this.conversations = conversations;
    this.orchestrator = orchestrator;
    this.properties = properties;
    this.assistantExecutor = assistantExecutor;
    this.objectMapper = objectMapper;
    this.speechTokens = speechTokens;
  }

  /** The user's open conversation with its recent history (created on first use). */
  @GetMapping("/conversations/current")
  public ConversationView current(@AuthenticationPrincipal FemmeUserPrincipal principal) {
    access.requireEnabled(principal);
    AssistantConversation c =
        conversations.getOrCreateCurrent(principal.getTenantId(), principal.getUserId());
    return conversations.view(c);
  }

  /** «Nueva conversación»: closes the open one and starts an empty one. */
  @PostMapping("/conversations")
  public ConversationView startNew(@AuthenticationPrincipal FemmeUserPrincipal principal) {
    access.requireEnabled(principal);
    AssistantConversation c =
        conversations.startNew(principal.getTenantId(), principal.getUserId());
    return conversations.view(c);
  }

  /**
   * Dictation (HU-AST-07): a short-lived Speech token so the browser talks to Azure AI Speech
   * directly. Same access as the rest of the assistant (flag on, salon user). The HTTP answer is
   * never cached by the browser; the service reuses one Azure token for a few minutes.
   */
  @GetMapping("/speech-token")
  public ResponseEntity<Map<String, Object>> speechToken(
      @AuthenticationPrincipal FemmeUserPrincipal principal) {
    access.requireEnabled(principal);
    try {
      SpeechTokenProvider.SpeechToken t = speechTokens.issue();
      return ResponseEntity.ok()
          .cacheControl(CacheControl.noStore())
          .body(
              Map.of(
                  "token", t.token(),
                  "region", t.region(),
                  "expiresInSeconds", t.expiresInSeconds()));
    } catch (SpeechTokenProvider.SpeechUnavailableException e) {
      log.error(
          "speech token unavailable tenantId={} reason={}",
          principal.getTenantId(),
          e.getMessage());
      throw new ResponseStatusException(
          HttpStatus.SERVICE_UNAVAILABLE, "ASSISTANT_SPEECH_UNAVAILABLE");
    }
  }

  /** Sends a message; the answer streams back as Server-Sent Events. */
  @PostMapping(path = "/messages", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
  public SseEmitter message(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @RequestBody(required = false) MessageRequest request) {
    access.requireEnabled(principal);
    String text = validText(request);
    if (request.conversationId() == null) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
    }
    long tenantId = principal.getTenantId();
    long userId = principal.getUserId();
    // 404 here (before the stream starts) if it is not the caller's own open conversation.
    conversations.requireOpen(request.conversationId(), tenantId, userId);

    // Everything the worker needs is captured now: it must not touch the security context.
    long conversationId = request.conversationId();
    AssistantContext ctx = AssistantContext.from(principal, request.currentPage(), conversationId);
    String inputMode = request.inputMode();

    SseEmitter emitter =
        new SseEmitter(properties.getRequestTimeoutSeconds() * 1000L + SSE_TIMEOUT_GRACE_MS);
    AssistantEventSink sink = new SseAssistantEventSink(emitter, objectMapper);
    Map<String, String> mdc = MDC.getCopyOfContextMap();
    try {
      assistantExecutor.execute(
          () -> {
            if (mdc != null) {
              MDC.setContextMap(mdc);
            }
            try {
              orchestrator.run(ctx, conversationId, text, inputMode, sink);
            } catch (RuntimeException e) {
              log.error("assistant worker crashed tenantId={}", ctx.tenantId(), e);
            } finally {
              emitter.complete();
              MDC.clear();
            }
          });
    } catch (RejectedExecutionException e) {
      log.error("assistant busy tenantId={}", tenantId);
      throw new ResponseStatusException(
          HttpStatus.SERVICE_UNAVAILABLE, "ASSISTANT_MODEL_UNAVAILABLE");
    }
    return emitter;
  }

  private String validText(MessageRequest request) {
    if (request == null || request.text() == null || request.text().isBlank()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "ASSISTANT_MESSAGE_EMPTY");
    }
    String text = request.text().trim();
    if (text.length() > properties.getMaxMessageChars()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "ASSISTANT_MESSAGE_TOO_LONG");
    }
    return text;
  }

  public record MessageRequest(
      Long conversationId, String text, String inputMode, String currentPage) {}
}
