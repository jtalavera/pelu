package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.Appointment;
import com.cursorpoc.backend.domain.enums.AppointmentStatus;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
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

  /**
   * Paged past appointments for a specific client within {@code [from, to)}, newest first. Used by
   * the client history "Anteriores" table (issue #59).
   */
  @Query(
      """
      SELECT a FROM Appointment a WHERE a.tenant.id = :tenantId
      AND a.client.id = :clientId
      AND a.startAt >= :from AND a.startAt < :to
      ORDER BY a.startAt DESC
      """)
  Page<Appointment> findClientHistoryPaged(
      @Param("tenantId") Long tenantId,
      @Param("clientId") Long clientId,
      @Param("from") Instant from,
      @Param("to") Instant to,
      Pageable pageable);

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

  /**
   * Issue #218 (email) / #225 (WhatsApp): appointments where at least one reminder channel hasn't
   * been sent yet for their current {@code startAt} slot, still in a remindable status, and due to
   * enter the reminder window on this run. The {@code OR} (rather than {@code AND}) is what lets an
   * appointment stay in the result set when e.g. the email already went out but WhatsApp hasn't --
   * the two channels are resolved and marked independently downstream, so this query only needs to
   * rule out appointments where BOTH are already done.
   */
  @Query(
      """
      SELECT a FROM Appointment a
      WHERE (a.reminderSentAt IS NULL OR a.whatsappReminderSentAt IS NULL)
      AND a.status IN :statuses
      AND a.startAt >= :from AND a.startAt < :to
      ORDER BY a.startAt ASC
      """)
  List<Appointment> findDueForReminder(
      @Param("statuses") List<AppointmentStatus> statuses,
      @Param("from") Instant from,
      @Param("to") Instant to);

  /**
   * Issue #222 — "Dashboard: gráfico de turnos por día de semana": raw start instants in {@code
   * [from, to)}, restricted to the same "counts as real appointment activity" statuses as {@link
   * #countDistinctClientsWithAppointmentsBetween} (excludes {@code CANCELLED}/{@code NO_SHOW}).
   * Projects only {@code startAt} — day-of-week bucketing needs no other column — leaving the
   * timezone-aware bucketing itself to {@code DashboardService} (in Java, using {@code
   * FemmeTimeProperties.zoneId()}) rather than a DB-side {@code GROUP BY}: SQL Server has no clean
   * IANA-timezone conversion, H2 (used in tests/e2e) would need a different one, and the
   * appointment volume here is salon-scale, so aggregating the already-small result set in memory
   * is both simpler and consistent across environments. Deterministic ordering (by {@code startAt}
   * ascending) even though the caller only counts, for consistency with every other ordered query
   * in this repository.
   */
  @Query(
      """
      SELECT a.startAt FROM Appointment a WHERE a.tenant.id = :tenantId
      AND a.status IN :statuses
      AND a.startAt >= :from AND a.startAt < :to
      ORDER BY a.startAt ASC
      """)
  List<Instant> findStartAtsByTenantAndStatusInAndStartAtBetween(
      @Param("tenantId") Long tenantId,
      @Param("statuses") List<AppointmentStatus> statuses,
      @Param("from") Instant from,
      @Param("to") Instant to);

  long deleteByTenant_Id(Long tenantId);

  boolean existsByClient_Id(Long clientId);
}
