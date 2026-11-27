package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.WhatsAppMessage;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface WhatsAppMessageRepository extends JpaRepository<WhatsAppMessage, Long> {

  Optional<WhatsAppMessage> findByTenantIdAndDedupKey(Long tenantId, String dedupKey);

  List<WhatsAppMessage> findByTenantIdAndAppointmentIdOrderByIdDesc(
      Long tenantId, Long appointmentId);

  Optional<WhatsAppMessage> findFirstByMetaMessageId(String metaMessageId);

  /**
   * QUEUED rows to send now: new ones whose post-commit wake-up was lost (a restart, a full
   * executor), and retries whose wait is over.
   */
  @Query(
      "SELECT m.id FROM WhatsAppMessage m WHERE m.status = 'QUEUED' AND"
          + " ((m.nextAttemptAt IS NULL AND m.queuedAt < :staleBefore)"
          + " OR (m.nextAttemptAt IS NOT NULL AND m.nextAttemptAt <= :now)) ORDER BY m.id")
  List<Long> findDueIds(
      @Param("staleBefore") Instant staleBefore, @Param("now") Instant now, Pageable page);

  /** FAILED notices whose one-time email fallback has not gone out yet (a retry of that step). */
  @Query(
      "SELECT m.id FROM WhatsAppMessage m WHERE m.status = 'FAILED' AND m.fallbackEmail IS NOT NULL"
          + " AND m.fallbackEmailSentAt IS NULL AND m.failedAt > :since ORDER BY m.id")
  List<Long> findFallbackPendingIds(@Param("since") Instant since, Pageable page);

  /** At-most-once claim of the email fallback. */
  @Modifying
  @Query(
      "UPDATE WhatsAppMessage m SET m.fallbackEmailSentAt = :now WHERE m.id = :id"
          + " AND m.fallbackEmailSentAt IS NULL AND m.status = 'FAILED'")
  int claimFallback(@Param("id") Long id, @Param("now") Instant now);

  @Modifying
  @Query("UPDATE WhatsAppMessage m SET m.fallbackEmailSentAt = NULL WHERE m.id = :id")
  int releaseFallback(@Param("id") Long id);

  /** Rows past the retention period whose recipient is still in the clear. */
  @Query(
      "SELECT m FROM WhatsAppMessage m WHERE m.recipientMaskedAt IS NULL AND m.queuedAt < :before"
          + " AND m.status <> 'QUEUED' AND m.status <> 'SENDING' ORDER BY m.id")
  List<WhatsAppMessage> findToMask(@Param("before") Instant before, Pageable page);

  /** Messages of one appointment in a given state (e.g. the QUEUED ones, to cancel them). */
  List<WhatsAppMessage> findByTenantIdAndAppointmentIdAndStatusAndPurposeIn(
      Long tenantId, Long appointmentId, String status, java.util.Collection<String> purposes);

  /** The notices of one appointment of a salon, newest first. */
  List<WhatsAppMessage> findByTenantIdAndAppointmentIdAndPurposeInOrderByIdDesc(
      Long tenantId, Long appointmentId, java.util.Collection<String> purposes);

  /** Atomic claim: only one worker moves a row from QUEUED to SENDING. */
  @Modifying
  @Query(
      "UPDATE WhatsAppMessage m SET m.status = 'SENDING', m.attempts = m.attempts + 1"
          + " WHERE m.id = :id AND m.status = 'QUEUED'")
  int claim(@Param("id") Long id);
}
