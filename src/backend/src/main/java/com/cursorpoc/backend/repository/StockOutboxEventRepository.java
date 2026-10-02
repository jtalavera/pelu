package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.StockOutboxEvent;
import com.cursorpoc.backend.domain.enums.StockEventType;
import com.cursorpoc.backend.domain.enums.StockOutboxStatus;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface StockOutboxEventRepository extends JpaRepository<StockOutboxEvent, Long> {

  /**
   * The tenant's oldest not-yet-finished event (PENDING, PROCESSING or FAILED) — its queue head.
   */
  Optional<StockOutboxEvent> findFirstByTenantIdAndStatusInOrderByIdAsc(
      Long tenantId, Collection<StockOutboxStatus> statuses);

  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("SELECT e FROM StockOutboxEvent e WHERE e.id = :id")
  Optional<StockOutboxEvent> lockById(@Param("id") Long id);

  /**
   * HU-60: tenants with work to do — a PENDING event that is due, or a PROCESSING one whose lease
   * expired (the worker died mid-call). Read by {@code StockOutboxReconciler} every minute.
   */
  @Query(
      """
      SELECT DISTINCT e.tenantId FROM StockOutboxEvent e
      WHERE (e.status = com.cursorpoc.backend.domain.enums.StockOutboxStatus.PENDING
             AND (e.nextAttemptAt IS NULL OR e.nextAttemptAt <= :now))
         OR (e.status = com.cursorpoc.backend.domain.enums.StockOutboxStatus.PROCESSING
             AND e.processingStartedAt < :leaseExpiry)
      """)
  List<Long> findTenantIdsWithDueEvents(
      @Param("now") Instant now, @Param("leaseExpiry") Instant leaseExpiry);

  long countByTenantIdAndSourceRefAndEventType(
      Long tenantId, String sourceRef, StockEventType eventType);

  long countByTenantIdAndSourceRefAndEventTypeAndStatusNot(
      Long tenantId, String sourceRef, StockEventType eventType, StockOutboxStatus status);

  long countByStatus(StockOutboxStatus status);

  @Query(
      """
      SELECT e FROM StockOutboxEvent e
      WHERE (:tenantId IS NULL OR e.tenantId = :tenantId)
        AND (:status IS NULL OR e.status = :status)
      ORDER BY e.id DESC
      """)
  Page<StockOutboxEvent> search(
      @Param("tenantId") Long tenantId,
      @Param("status") StockOutboxStatus status,
      Pageable pageable);

  @Query(
      """
      SELECT e FROM StockOutboxEvent e
      WHERE e.status IN :statuses
        AND (:tenantId IS NULL OR e.tenantId = :tenantId)
      ORDER BY e.id DESC
      """)
  Page<StockOutboxEvent> searchInStatuses(
      @Param("tenantId") Long tenantId,
      @Param("statuses") Collection<StockOutboxStatus> statuses,
      Pageable pageable);

  List<StockOutboxEvent> findByTenantIdOrderByIdAsc(Long tenantId);
}
