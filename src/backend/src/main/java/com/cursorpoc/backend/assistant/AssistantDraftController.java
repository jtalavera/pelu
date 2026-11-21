package com.cursorpoc.backend.assistant;

import com.cursorpoc.backend.security.FemmeUserPrincipal;
import com.cursorpoc.backend.service.AuditLogService;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * What a person does with the card of a draft: complete what is missing, discard it, or CONFIRM it.
 * Confirming is a plain REST call from a button — there is no «confirm» tool for the model — and it
 * is recorded in the audit trail as the business action it is, with source {@code ASSISTANT}.
 */
@RestController
@RequestMapping("/api/assistant/drafts")
public class AssistantDraftController {

  private final AssistantAccess access;
  private final AssistantDraftService drafts;
  private final AuditLogService auditLogService;

  public AssistantDraftController(
      AssistantAccess access, AssistantDraftService drafts, AuditLogService auditLogService) {
    this.access = access;
    this.drafts = drafts;
    this.auditLogService = auditLogService;
  }

  /**
   * {@code Idempotency-Key} must be the draft id when sent; the draft's state is the real guard (a
   * double tap cannot issue twice, the second answer is 409 {@code
   * ASSISTANT_DRAFT_ALREADY_CONFIRMED} carrying the original result).
   */
  @PostMapping("/{id}/confirm")
  public AssistantDraftService.ConfirmResult confirm(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("id") UUID id,
      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
    access.requireEnabled(principal);
    if (idempotencyKey != null && !idempotencyKey.equals(id.toString())) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
    }
    AssistantDraftService.ConfirmResult result = drafts.confirm(principal, id);
    if (result.invoiceId() != null) {
      auditLogService.recordBusinessAction(
          principal,
          "invoices",
          "issue",
          String.valueOf(result.invoiceId()),
          AuditLogService.SOURCE_ASSISTANT);
    }
    if (result.appointmentId() != null) {
      auditLogService.recordBusinessAction(
          principal,
          "appointments",
          "create",
          String.valueOf(result.appointmentId()),
          AuditLogService.SOURCE_ASSISTANT);
    }
    return result;
  }

  @PostMapping("/{id}/discard")
  public AssistantDraftDto discard(
      @AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable("id") UUID id) {
    access.requireEnabled(principal);
    return drafts.discard(principal.getTenantId(), principal.getUserId(), id);
  }

  /** Completes what the card asks for: payment method, card brand, e-mail. */
  @PatchMapping("/{id}")
  public AssistantDraftDto complete(
      @AuthenticationPrincipal FemmeUserPrincipal principal,
      @PathVariable("id") UUID id,
      @RequestBody(required = false) AssistantDraftService.Completion completion) {
    access.requireEnabled(principal);
    if (completion == null) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST");
    }
    Long own = principal.isProfessional() ? principal.getProfessionalId() : null;
    return drafts.complete(principal.getTenantId(), principal.getUserId(), own, id, completion);
  }
}
