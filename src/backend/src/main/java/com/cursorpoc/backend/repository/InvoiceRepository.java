package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.Invoice;
import com.cursorpoc.backend.domain.enums.InvoiceStatus;
import com.cursorpoc.backend.domain.enums.SifenSubmissionStatus;
import jakarta.persistence.LockModeType;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface InvoiceRepository extends JpaRepository<Invoice, Long> {

  Optional<Invoice> findByIdAndTenant_Id(Long id, Long tenantId);

  /**
   * RT-20: same pessimistic-row-lock pattern as {@code FiscalStampRepository.lockByIdAndTenantId} —
   * used by {@code SifenInvoiceSubmissionPersistenceService#claimForSubmission} so two concurrent
   * claims for the same invoice can never both see "unclaimed" (a plain read-then-write would race;
   * the second transaction blocks here until the first commits).
   */
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("SELECT i FROM Invoice i WHERE i.id = :id AND i.tenant.id = :tenantId")
  Optional<Invoice> lockByIdAndTenantId(@Param("id") Long id, @Param("tenantId") Long tenantId);

  /**
   * RT-20: drives {@code SifenSubmissionReconciler} — covers both invoices never enqueued at all
   * (QUEUED, sifenNextAttemptAt still null) and invoices due for a backoff retry
   * (PENDING_VERIFICATION, sifenNextAttemptAt elapsed), skipping anything another instance
   * currently holds the lease on.
   */
  @Query(
      """
      SELECT i FROM Invoice i
      WHERE i.sifenSubmissionStatus IN :statuses
      AND (i.sifenNextAttemptAt IS NULL OR i.sifenNextAttemptAt <= :now)
      AND (i.sifenProcessingStartedAt IS NULL OR i.sifenProcessingStartedAt < :leaseExpiry)
      AND i.sifenAttemptCount < :maxAttempts
      """)
  List<Invoice> findDueForSifenRetry(
      @Param("statuses") List<SifenSubmissionStatus> statuses,
      @Param("now") LocalDateTime now,
      @Param("leaseExpiry") LocalDateTime leaseExpiry,
      @Param("maxAttempts") int maxAttempts);

  boolean existsByTenant_IdAndFiscalStamp_Id(Long tenantId, Long fiscalStampId);

  List<Invoice> findByTenant_IdAndIssuedAtBetweenOrderByIssuedAtDesc(
      Long tenantId, Instant from, Instant to);

  @Query(
      """
      SELECT i FROM Invoice i
      WHERE i.tenant.id = :tenantId
      AND (:fromDate IS NULL OR i.issuedAt >= :fromDate)
      AND (:toDate IS NULL OR i.issuedAt <= :toDate)
      AND (:clientId IS NULL OR i.client.id = :clientId)
      AND (:status IS NULL OR i.status = :status)
      AND (:q IS NULL
           OR LOWER(i.clientDisplayName) LIKE LOWER(CONCAT('%', :q, '%'))
           OR CAST(i.invoiceNumber AS string) LIKE CONCAT('%', :q, '%')
           OR (:qInvoiceNumber IS NOT NULL AND i.invoiceNumber = :qInvoiceNumber))
      ORDER BY i.issuedAt DESC
      """)
  Page<Invoice> findByTenantWithFiltersPaged(
      @Param("tenantId") Long tenantId,
      @Param("fromDate") Instant fromDate,
      @Param("toDate") Instant toDate,
      @Param("clientId") Long clientId,
      @Param("status") InvoiceStatus status,
      @Param("q") String q,
      @Param("qInvoiceNumber") Integer qInvoiceNumber,
      Pageable pageable);

  /**
   * Issue #181: header-only projection for the "Historial de comprobantes" Excel/PDF report. Same
   * filters and ordering as {@link #findByTenantWithFiltersPaged}, but a single query with no lazy
   * {@code lines}/{@code paymentAllocations}/{@code client} loading per row (the report shows only
   * cabecera data) — {@code LEFT JOIN i.client c} + {@code COALESCE} resolves the display name the
   * same way {@code InvoiceService.toListItemDto} does.
   */
  @Query(
      """
      SELECT new com.cursorpoc.backend.service.InvoiceReportRow(
          i.invoiceNumber,
          COALESCE(c.fullName, i.clientDisplayName),
          i.status,
          i.total,
          i.issuedAt,
          i.sifenSubmissionStatus)
      FROM Invoice i
      LEFT JOIN i.client c
      WHERE i.tenant.id = :tenantId
      AND (:fromDate IS NULL OR i.issuedAt >= :fromDate)
      AND (:toDate IS NULL OR i.issuedAt <= :toDate)
      AND (:clientId IS NULL OR i.client.id = :clientId)
      AND (:status IS NULL OR i.status = :status)
      AND (:q IS NULL
           OR LOWER(i.clientDisplayName) LIKE LOWER(CONCAT('%', :q, '%'))
           OR CAST(i.invoiceNumber AS string) LIKE CONCAT('%', :q, '%')
           OR (:qInvoiceNumber IS NOT NULL AND i.invoiceNumber = :qInvoiceNumber))
      ORDER BY i.issuedAt DESC
      """)
  List<com.cursorpoc.backend.service.InvoiceReportRow> findReportRows(
      @Param("tenantId") Long tenantId,
      @Param("fromDate") Instant fromDate,
      @Param("toDate") Instant toDate,
      @Param("clientId") Long clientId,
      @Param("status") InvoiceStatus status,
      @Param("q") String q,
      @Param("qInvoiceNumber") Integer qInvoiceNumber,
      Pageable pageable);

  @Query(
      """
      SELECT COALESCE(SUM(i.total), 0) FROM Invoice i
      WHERE i.tenant.id = :tenantId
      AND i.status = 'ISSUED'
      AND (:fromDate IS NULL OR i.issuedAt >= :fromDate)
      AND (:toDate IS NULL OR i.issuedAt <= :toDate)
      AND (:clientId IS NULL OR i.client.id = :clientId)
      AND (:q IS NULL
           OR LOWER(i.clientDisplayName) LIKE LOWER(CONCAT('%', :q, '%'))
           OR CAST(i.invoiceNumber AS string) LIKE CONCAT('%', :q, '%')
           OR (:qInvoiceNumber IS NOT NULL AND i.invoiceNumber = :qInvoiceNumber))
      """)
  BigDecimal sumIssuedTotalWithFilters(
      @Param("tenantId") Long tenantId,
      @Param("fromDate") Instant fromDate,
      @Param("toDate") Instant toDate,
      @Param("clientId") Long clientId,
      @Param("q") String q,
      @Param("qInvoiceNumber") Integer qInvoiceNumber);

  @Query(
      """
      SELECT COALESCE(MAX(i.invoiceNumber), 0) FROM Invoice i
      WHERE i.tenant.id = :tenantId AND i.fiscalStamp.id = :fiscalStampId
      """)
  int findMaxInvoiceNumberByTenantAndFiscalStamp(
      @Param("tenantId") Long tenantId, @Param("fiscalStampId") Long fiscalStampId);

  List<Invoice> findByCashSession_IdAndTenant_Id(Long cashSessionId, Long tenantId);

  @Query(
      """
      SELECT COALESCE(SUM(i.total), 0) FROM Invoice i
      WHERE i.tenant.id = :tenantId AND i.status = :status
      AND i.issuedAt >= :from AND i.issuedAt < :to
      """)
  BigDecimal sumTotalByTenantAndStatusAndIssuedBetween(
      @Param("tenantId") Long tenantId,
      @Param("status") InvoiceStatus status,
      @Param("from") Instant from,
      @Param("to") Instant to);

  @Query(
      """
      SELECT COALESCE(SUM(p.amount), 0) FROM InvoicePaymentAllocation p
      JOIN p.invoice i
      WHERE i.tenant.id = :tenantId AND i.status = :status
      AND i.issuedAt >= :from AND i.issuedAt < :to
      """)
  BigDecimal sumPaymentsByTenantAndStatusAndIssuedBetween(
      @Param("tenantId") Long tenantId,
      @Param("status") InvoiceStatus status,
      @Param("from") Instant from,
      @Param("to") Instant to);

  @Query(
      """
      SELECT COALESCE(SUM(i.total), 0) FROM Invoice i
      WHERE i.cashSession.id = :cashSessionId AND i.status = :status
      """)
  BigDecimal sumTotalByCashSessionAndStatus(
      @Param("cashSessionId") Long cashSessionId, @Param("status") InvoiceStatus status);

  @Query(
      """
      SELECT COUNT(i) FROM Invoice i
      WHERE i.cashSession.id = :cashSessionId AND i.status = :status
      """)
  long countByCashSessionAndStatus(
      @Param("cashSessionId") Long cashSessionId, @Param("status") InvoiceStatus status);

  List<Invoice> findAllByTenant_Id(Long tenantId);

  List<Invoice> findAllByClient_Tenant_Id(Long tenantId);

  boolean existsByClient_Id(Long clientId);

  boolean existsByServiceRecord_Id(Long serviceRecordId);

  Optional<Invoice> findByServiceRecord_Id(Long serviceRecordId);
}
