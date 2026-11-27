package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.WhatsAppMessage;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface WhatsAppMessageRepository extends JpaRepository<WhatsAppMessage, Long> {

  Optional<WhatsAppMessage> findByTenantIdAndDedupKey(Long tenantId, String dedupKey);

  List<WhatsAppMessage> findByTenantIdAndAppointmentIdOrderByIdDesc(
      Long tenantId, Long appointmentId);

  /** QUEUED rows whose post-commit wake-up was lost (a restart, a full executor). */
  List<WhatsAppMessage> findTop50ByStatusAndQueuedAtBeforeOrderByIdAsc(
      String status, Instant queuedBefore);

  /** Atomic claim: only one worker moves a row from QUEUED to SENDING. */
  @Modifying
  @Query(
      "UPDATE WhatsAppMessage m SET m.status = 'SENDING', m.attempts = m.attempts + 1"
          + " WHERE m.id = :id AND m.status = 'QUEUED'")
  int claim(@Param("id") Long id);
}
