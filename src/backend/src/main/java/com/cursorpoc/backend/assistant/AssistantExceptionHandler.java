package com.cursorpoc.backend.assistant;

import java.util.Map;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

/**
 * Errors of {@link AssistantController} and {@link AssistantDraftController} that happen BEFORE a
 * stream starts (flag off, unknown conversation, empty text…) as JSON {@code {"error": "CODE"}}
 * whatever the client {@code Accept}s.
 *
 * <p>A browser asks for {@code text/event-stream} only, and Spring cannot render a JSON body for
 * that: the error would fall through to the container's error page, which Security then refuses
 * with a misleading 403. Setting the content type explicitly skips that negotiation. This advice
 * wins over the global handler for this controller only.
 */
@RestControllerAdvice(assignableTypes = {AssistantController.class, AssistantDraftController.class})
@Order(Ordered.HIGHEST_PRECEDENCE)
class AssistantExceptionHandler {

  @ExceptionHandler(ResponseStatusException.class)
  ResponseEntity<Map<String, String>> handleStatus(ResponseStatusException ex) {
    return json(
        HttpStatus.valueOf(ex.getStatusCode().value()),
        ex.getReason() != null ? ex.getReason() : ex.getStatusCode().toString());
  }

  @ExceptionHandler(HttpMessageNotReadableException.class)
  ResponseEntity<Map<String, String>> handleUnreadable(HttpMessageNotReadableException ex) {
    return json(HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
  }

  /** A draft operation refused; the body may carry what the card needs to recover. */
  @ExceptionHandler(AssistantDraftException.class)
  ResponseEntity<Map<String, Object>> handleDraft(AssistantDraftException ex) {
    Map<String, Object> body = new java.util.LinkedHashMap<>();
    body.put("error", ex.code());
    body.putAll(ex.extra());
    return ResponseEntity.status(ex.status()).contentType(MediaType.APPLICATION_JSON).body(body);
  }

  @ExceptionHandler(
      org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class)
  ResponseEntity<Map<String, String>> handleBadPathValue(
      org.springframework.web.method.annotation.MethodArgumentTypeMismatchException ex) {
    return json(HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
  }

  private static ResponseEntity<Map<String, String>> json(HttpStatus status, String code) {
    return ResponseEntity.status(status)
        .contentType(MediaType.APPLICATION_JSON)
        .body(Map.of("error", code));
  }
}
