package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.Appointment;
import com.cursorpoc.backend.domain.enums.AppointmentStatus;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AppointmentRepository extends JpaRepository<Appointment, Long> {

  Optional<Appointment> findByIdAndTenant_Id(Long id, Long tenantId);

  @Query(
      """
      SELECT COUNT(a) FROM Appointment a WHERE a.tenant.id = :tenantId
      AND a.professional.id = :professionalId
      AND a.status <> :cancelled
      AND a.startAt < :endAt AND a.endAt > :startAt
      AND (:excludeId IS NULL OR a.id <> :excludeId)
      """)
  long countOverlapping(
      @Param("tenantId") Long tenantId,
      @Param("professionalId") Long professionalId,
      @Param("startAt") Instant startAt,
      @Param("endAt") Instant endAt,
      @Param("excludeId") Long excludeId,
      @Param("cancelled") AppointmentStatus cancelled);

  @Query(
      """
      SELECT a FROM Appointment a WHERE a.tenant.id = :tenantId
      AND a.startAt >= :from AND a.startAt < :to
      ORDER BY a.startAt ASC
      """)
  List<Appointment> findInRange(
      @Param("tenantId") Long tenantId, @Param("from") Instant from, @Param("to") Instant to);

  @Query(
      """
      SELECT a FROM Appointment a WHERE a.tenant.id = :tenantId
      AND a.startAt >= :from AND a.startAt < :to
      AND (:professionalId IS NULL OR a.professional.id = :professionalId)
      AND (:clientId IS NULL OR (a.client IS NOT NULL AND a.client.id = :clientId))
      ORDER BY a.startAt ASC
      """)
  List<Appointment> findInRangeFiltered(
      @Param("tenantId") Long tenantId,
      @Param("from") Instant from,
      @Param("to") Instant to,
      @Param("professionalId") Long professionalId,
      @Param("clientId") Long clientId);

  long countByTenant_IdAndStatus(Long tenantId, AppointmentStatus status);

  long countByTenant_IdAndStatusAndStartAtGreaterThanEqualAndStartAtLessThan(
      Long tenantId, AppointmentStatus status, Instant startInclusive, Instant endExclusive);

  @Query(
      """
      SELECT COUNT(a) FROM Appointment a WHERE a.tenant.id = :tenantId
      AND a.startAt >= :dayStart AND a.startAt < :dayEnd
      """)
  long countByTenantIdAndDay(
      @Param("tenantId") Long tenantId,
      @Param("dayStart") Instant dayStart,
      @Param("dayEnd") Instant dayEnd);

  /**
   * Distinct registered clients with at least one non-cancelled appointment in {@code [from, to)}.
   */
  @Query(
      """
      SELECT COUNT(DISTINCT a.client.id) FROM Appointment a
      WHERE a.tenant.id = :tenantId
      AND a.client IS NOT NULL
      AND a.startAt >= :from AND a.startAt < :to
      AND a.status IN ('PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED')
      """)
  long countDistinctClientsWithAppointmentsBetween(
      @Param("tenantId") Long tenantId, @Param("from") Instant from, @Param("to") Instant to);
}
