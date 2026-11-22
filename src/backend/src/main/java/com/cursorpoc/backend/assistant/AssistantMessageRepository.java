package com.cursorpoc.backend.assistant;

import java.util.Collection;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AssistantMessageRepository extends JpaRepository<AssistantMessage, Long> {

  /**
   * Newest first; callers reverse. Used to build the (trimmed) model context and the UI history.
   */
  List<AssistantMessage> findByConversationIdAndRoleInOrderByIdDesc(
      Long conversationId, Collection<AssistantMessageRole> roles, Pageable pageable);

  @Modifying
  @Query("DELETE FROM AssistantMessage m WHERE m.conversationId IN :conversationIds")
  int deleteByConversationIds(@Param("conversationIds") Collection<Long> conversationIds);
}
