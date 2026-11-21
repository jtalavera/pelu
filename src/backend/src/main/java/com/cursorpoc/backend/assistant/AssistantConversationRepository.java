package com.cursorpoc.backend.assistant;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AssistantConversationRepository
    extends JpaRepository<AssistantConversation, Long> {

  Optional<AssistantConversation> findFirstByTenantIdAndUserIdAndClosedAtIsNullOrderByIdDesc(
      Long tenantId, Long userId);

  Optional<AssistantConversation> findByIdAndTenantIdAndUserId(Long id, Long tenantId, Long userId);

  @Query("SELECT c.id FROM AssistantConversation c WHERE c.lastActivity < :cutoff")
  List<Long> findIdsInactiveSince(@Param("cutoff") Instant cutoff);
}
