package com.cursorpoc.backend.assistant;

import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Deletes conversations (and their messages) idle for longer than the retention period. */
@Component
public class AssistantRetentionJob {

  private static final Logger log = LoggerFactory.getLogger(AssistantRetentionJob.class);

  private final AssistantConversationService conversations;
  private final AssistantDraftService drafts;

  public AssistantRetentionJob(
      AssistantConversationService conversations, AssistantDraftService drafts) {
    this.conversations = conversations;
    this.drafts = drafts;
  }

  /** Drafts nobody confirmed in 24 h read as expired right away; this makes it official. */
  @Scheduled(cron = "0 */15 * * * *")
  public void expireDrafts() {
    try {
      int expired = drafts.expireDue();
      if (expired > 0) {
        log.info("assistant drafts expired: {}", expired);
      }
    } catch (RuntimeException e) {
      log.error("assistant draft expiry failed", e);
    }
  }

  @Scheduled(cron = "0 30 3 * * *", zone = "${app.femme.business-zone-id:America/Asuncion}")
  public void purge() {
    try {
      int deleted =
          conversations.deleteInactiveSince(Instant.now().minus(conversations.retention()));
      log.info("assistant retention deleted {} conversation(s)", deleted);
    } catch (RuntimeException e) {
      log.error("assistant retention failed", e);
    }
  }
}
