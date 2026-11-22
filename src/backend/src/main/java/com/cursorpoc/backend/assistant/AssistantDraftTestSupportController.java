package com.cursorpoc.backend.assistant;

import com.cursorpoc.backend.security.FemmeUserPrincipal;
import java.time.Instant;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Test-only support endpoint, gated behind {@code femme.data-init.enabled} (true only for the
 * {@code e2e} Spring profile — never reachable in production), like the other {@code
 * *-test-support} controllers. A draft expires 24 hours after it was proposed; Playwright cannot
 * wait that long, so a spec moves the expiry of one of ITS OWN drafts into the past (tenant AND
 * user scoped).
 */
@RestController
@RequestMapping("/api/admin/assistant-test-support")
@ConditionalOnProperty(name = "femme.data-init.enabled", havingValue = "true")
public class AssistantDraftTestSupportController {

  private final AssistantDraftRepository drafts;

  public AssistantDraftTestSupportController(AssistantDraftRepository drafts) {
    this.drafts = drafts;
  }

  @PostMapping("/drafts/{id}/expire")
  @Transactional
  public void expire(@AuthenticationPrincipal FemmeUserPrincipal principal, @PathVariable UUID id) {
    if (principal == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED");
    }
    AssistantDraft draft =
        drafts
            .findByIdAndTenantIdAndUserId(id, principal.getTenantId(), principal.getUserId())
            .orElseThrow(
                () ->
                    new ResponseStatusException(HttpStatus.NOT_FOUND, "ASSISTANT_DRAFT_NOT_FOUND"));
    draft.setExpiresAt(Instant.now().minusSeconds(60));
    drafts.save(draft);
  }
}
