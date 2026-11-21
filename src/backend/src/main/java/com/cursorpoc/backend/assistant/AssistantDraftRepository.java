package com.cursorpoc.backend.assistant;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AssistantDraftRepository extends JpaRepository<AssistantDraft, UUID> {

  /** A draft of this person (tenant AND user): anyone else's id is simply "not found". */
  Optional<AssistantDraft> findByIdAndTenantIdAndUserId(UUID id, Long tenantId, Long userId);

  List<AssistantDraft> findByConversationIdAndStatus(
      Long conversationId, AssistantDraftStatus status);

  List<AssistantDraft> findByConversationIdOrderByCreatedAtAsc(Long conversationId);

  /**
   * Takes the draft for confirmation: DRAFT → CONFIRMING in ONE atomic statement, so a double tap
   * cannot issue twice — the second request waits for the first one's row lock and then finds it no
   * longer DRAFT. 1 = taken, 0 = not available (already confirming/confirmed, discarded, superseded
   * or expired).
   */
  @Modifying(flushAutomatically = true, clearAutomatically = true)
  @Query(
      "UPDATE AssistantDraft d SET d.status = com.cursorpoc.backend.assistant.AssistantDraftStatus.CONFIRMING, d.updatedAt = :now"
          + " WHERE d.id = :id AND d.tenantId = :tenantId AND d.userId = :userId"
          + " AND d.status = com.cursorpoc.backend.assistant.AssistantDraftStatus.DRAFT AND d.expiresAt > :now")
  int claim(
      @Param("id") UUID id,
      @Param("tenantId") Long tenantId,
      @Param("userId") Long userId,
      @Param("now") Instant now);

  /** Drafts nobody confirmed in time. */
  @Modifying(flushAutomatically = true, clearAutomatically = true)
  @Query(
      "UPDATE AssistantDraft d SET d.status = com.cursorpoc.backend.assistant.AssistantDraftStatus.EXPIRED, d.updatedAt = :now"
          + " WHERE d.status = com.cursorpoc.backend.assistant.AssistantDraftStatus.DRAFT AND d.expiresAt <= :now")
  int expireDue(@Param("now") Instant now);
}
