package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.AuditLog;
import java.time.Instant;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AuditLogRepository extends JpaRepository<AuditLog, Long> {

  /**
   * Newest first. {@code tenantId} null = every tenant (platform view); {@code q} is matched
   * against the user's email, case-insensitively.
   */
  @Query(
      """
      SELECT a FROM AuditLog a
      WHERE (:tenantId IS NULL OR a.tenantId = :tenantId)
      AND (:fromDate IS NULL OR a.createdAt >= :fromDate)
      AND (:toDate IS NULL OR a.createdAt < :toDate)
      AND (:resource IS NULL OR a.resource = :resource)
      AND (:q IS NULL OR LOWER(a.userEmail) LIKE LOWER(CONCAT('%', :q, '%')))
      ORDER BY a.createdAt DESC, a.id DESC
      """)
  Page<AuditLog> search(
      @Param("tenantId") Long tenantId,
      @Param("fromDate") Instant fromDate,
      @Param("toDate") Instant toDate,
      @Param("resource") String resource,
      @Param("q") String q,
      Pageable pageable);
}
