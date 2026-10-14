package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.CommissionEntry;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CommissionEntryRepository extends JpaRepository<CommissionEntry, Long> {

  List<CommissionEntry> findByTenantIdAndInvoiceIdOrderByIdAsc(long tenantId, long invoiceId);

  List<CommissionEntry> findBySettlementIdOrderByAccrualAtAscIdAsc(long settlementId);

  boolean existsByReversesEntryId(long reversesEntryId);

  /**
   * Entries that still count: INVOICE_LINE entries of the tenant whose accrual is at or after
   * {@code from} and that no REVERSAL row compensates yet.
   */
  @Query(
      """
      SELECT e FROM CommissionEntry e
      WHERE e.tenantId = :tenantId
        AND e.sourceType = com.cursorpoc.backend.domain.enums.CommissionEntrySource.INVOICE_LINE
        AND e.accrualAt >= :from
        AND NOT EXISTS (SELECT r.id FROM CommissionEntry r WHERE r.reversesEntryId = e.id)
      ORDER BY e.accrualAt ASC, e.id ASC
      """)
  List<CommissionEntry> findLiveLineEntriesSince(
      @Param("tenantId") long tenantId, @Param("from") Instant from);

  @Query(
      """
      SELECT e FROM CommissionEntry e
      WHERE e.tenantId = :tenantId
        AND e.sourceType = com.cursorpoc.backend.domain.enums.CommissionEntrySource.INVOICE_LINE
        AND e.invoiceId = :invoiceId
        AND NOT EXISTS (SELECT r.id FROM CommissionEntry r WHERE r.reversesEntryId = e.id)
      ORDER BY e.id ASC
      """)
  List<CommissionEntry> findLiveLineEntriesOfInvoice(
      @Param("tenantId") long tenantId, @Param("invoiceId") long invoiceId);

  /** Unsettled entries of a beneficiary accrued before {@code before} (exclusive). */
  @Query(
      """
      SELECT e FROM CommissionEntry e
      WHERE e.tenantId = :tenantId AND e.professionalId = :professionalId
        AND e.settlementId IS NULL AND e.accrualAt < :before
      ORDER BY e.accrualAt ASC, e.id ASC
      """)
  List<CommissionEntry> findUnsettled(
      @Param("tenantId") long tenantId,
      @Param("professionalId") long professionalId,
      @Param("before") Instant before);

  @Query(
      """
      SELECT DISTINCT e.professionalId FROM CommissionEntry e
      WHERE e.tenantId = :tenantId AND e.settlementId IS NULL AND e.accrualAt < :before
      """)
  List<Long> findProfessionalsWithUnsettled(
      @Param("tenantId") long tenantId, @Param("before") Instant before);

  @Query(
      """
      SELECT e FROM CommissionEntry e
      WHERE e.tenantId = :tenantId
        AND e.accrualAt >= :from AND e.accrualAt < :to
        AND (:professionalId IS NULL OR e.professionalId = :professionalId)
      ORDER BY e.accrualAt ASC, e.id ASC
      """)
  List<CommissionEntry> findForReport(
      @Param("tenantId") long tenantId,
      @Param("from") Instant from,
      @Param("to") Instant to,
      @Param("professionalId") Long professionalId);

  List<CommissionEntry> findBySettlementIdIn(Collection<Long> settlementIds);
}
