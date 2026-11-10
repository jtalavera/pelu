package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.ManualTip;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Tips loaded by hand by the salon administrator; voided ones never count towards a balance. */
public interface ManualTipRepository extends JpaRepository<ManualTip, Long> {

  Optional<ManualTip> findByIdAndTenant_Id(Long id, Long tenantId);

  long deleteByTenant_Id(Long tenantId);

  @Query(
      """
      SELECT COALESCE(SUM(m.amount), 0) FROM ManualTip m
      WHERE m.tenant.id = :tenantId
      AND m.professional.id = :professionalId
      AND m.voidedAt IS NULL
      """)
  BigDecimal sumForProfessional(
      @Param("tenantId") Long tenantId, @Param("professionalId") Long professionalId);

  /**
   * Manual tips (voided ones included, so Movimientos can show them as «Anulada») within the
   * report's date window. {@code professionalIds} must be non-empty.
   */
  @Query(
      """
      SELECT m FROM ManualTip m
      JOIN FETCH m.professional p
      LEFT JOIN FETCH m.createdBy
      LEFT JOIN FETCH m.voidedBy
      WHERE m.tenant.id = :tenantId
      AND (:fromDate IS NULL OR m.tippedAt >= :fromDate)
      AND (:toDate IS NULL OR m.tippedAt <= :toDate)
      AND p.id IN :professionalIds
      ORDER BY p.fullName ASC, m.tippedAt ASC
      """)
  List<ManualTip> findForReport(
      @Param("tenantId") Long tenantId,
      @Param("fromDate") Instant fromDate,
      @Param("toDate") Instant toDate,
      @Param("professionalIds") List<Long> professionalIds);
}
