package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.ServiceRecordTip;
import com.cursorpoc.backend.domain.enums.ServiceRecordStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ServiceRecordTipRepository extends JpaRepository<ServiceRecordTip, Long> {

  /**
   * {@code professionalIds} must be non-empty; callers resolve "no filter" to all tenant
   * professional ids.
   */
  @Query(
      """
      SELECT t FROM ServiceRecordTip t
      JOIN FETCH t.serviceRecord r
      JOIN FETCH r.client c
      JOIN FETCH t.professional p
      WHERE r.tenant.id = :tenantId
      AND r.status = :status
      AND (:fromDate IS NULL OR r.closedAt >= :fromDate)
      AND (:toDate IS NULL OR r.closedAt <= :toDate)
      AND p.id IN :professionalIds
      ORDER BY p.fullName ASC, r.closedAt ASC
      """)
  List<ServiceRecordTip> findForReport(
      @Param("tenantId") Long tenantId,
      @Param("status") ServiceRecordStatus status,
      @Param("fromDate") Instant fromDate,
      @Param("toDate") Instant toDate,
      @Param("professionalIds") List<Long> professionalIds);

  @Query(
      """
      SELECT COALESCE(SUM(t.amount), 0) FROM ServiceRecordTip t
      WHERE t.serviceRecord.tenant.id = :tenantId
      AND t.serviceRecord.status = :status
      AND t.professional.id = :professionalId
      """)
  BigDecimal sumForProfessional(
      @Param("tenantId") Long tenantId,
      @Param("professionalId") Long professionalId,
      @Param("status") ServiceRecordStatus status);
}
