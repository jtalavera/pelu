package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.ServiceRecord;
import com.cursorpoc.backend.domain.enums.ServiceRecordStatus;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ServiceRecordRepository extends JpaRepository<ServiceRecord, Long> {

  Optional<ServiceRecord> findByIdAndTenant_Id(Long id, Long tenantId);

  long deleteByTenant_Id(Long tenantId);

  @Query(
      """
      SELECT r FROM ServiceRecord r
      WHERE r.tenant.id = :tenantId
      AND (:fromDate IS NULL OR r.createdAt >= :fromDate)
      AND (:toDate IS NULL OR r.createdAt <= :toDate)
      AND (:clientId IS NULL OR r.client.id = :clientId)
      AND (:status IS NULL OR r.status = :status)
      AND (:q IS NULL OR LOWER(r.client.fullName) LIKE LOWER(CONCAT('%', :q, '%')))
      ORDER BY r.createdAt DESC
      """)
  Page<ServiceRecord> findByTenantWithFiltersPaged(
      @Param("tenantId") Long tenantId,
      @Param("fromDate") Instant fromDate,
      @Param("toDate") Instant toDate,
      @Param("clientId") Long clientId,
      @Param("status") ServiceRecordStatus status,
      @Param("q") String q,
      Pageable pageable);

  /** HU-67: a client's records in one status, with lines, item and professional fetched. */
  @Query(
      """
      SELECT DISTINCT r FROM ServiceRecord r
      LEFT JOIN FETCH r.lines l
      LEFT JOIN FETCH l.salonService
      LEFT JOIN FETCH l.professional
      WHERE r.tenant.id = :tenantId
      AND r.client.id = :clientId
      AND r.status = :status
      """)
  List<ServiceRecord> findByTenantAndClientAndStatusWithLines(
      @Param("tenantId") Long tenantId,
      @Param("clientId") Long clientId,
      @Param("status") ServiceRecordStatus status);

  /**
   * Visits per client — CLOSED service records, same rule as the profile summary (HU-67): rows of
   * {@code [clientId, count, lastClosedAt]}.
   */
  @Query(
      """
      SELECT r.client.id, COUNT(r), MAX(r.closedAt) FROM ServiceRecord r
      WHERE r.tenant.id = :tenantId
      AND r.status = :status
      AND r.client.id IN :clientIds
      GROUP BY r.client.id
      """)
  List<Object[]> countByClientIds(
      @Param("tenantId") Long tenantId,
      @Param("status") ServiceRecordStatus status,
      @Param("clientIds") Collection<Long> clientIds);
}
