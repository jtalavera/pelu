package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.Client;
import com.cursorpoc.backend.domain.enums.AppointmentStatus;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ClientRepository extends JpaRepository<Client, Long> {

  Optional<Client> findByIdAndTenant_Id(Long id, Long tenantId);

  List<Client> findByTenant_Id(Long tenantId);

  @Query(
      """
      SELECT c FROM Client c WHERE c.tenant.id = :tenantId
      AND (:q IS NULL
           OR LOWER(c.fullName) LIKE LOWER(CONCAT('%', :q, '%'))
           OR (c.phone IS NOT NULL AND c.phone LIKE CONCAT('%', :q, '%'))
           OR (c.email IS NOT NULL AND LOWER(c.email) LIKE LOWER(CONCAT('%', :q, '%')))
           OR (c.ruc IS NOT NULL AND c.ruc LIKE CONCAT('%', :q, '%')))
      AND (:active IS NULL OR c.active = :active)
      AND (:withRuc IS NULL OR c.ruc IS NOT NULL)
      AND (:isNew IS NULL OR c.visitCount = 0)
      ORDER BY c.fullName ASC
      """)
  Page<Client> findByTenantFilteredPaged(
      @Param("tenantId") Long tenantId,
      @Param("q") String q,
      @Param("active") Boolean active,
      @Param("withRuc") Boolean withRuc,
      @Param("isNew") Boolean isNew,
      Pageable pageable);

  @Query(
      "SELECT c FROM Client c WHERE c.tenant.id = :tenantId AND LOWER(c.email) = LOWER(:email) AND c.email IS NOT NULL")
  Optional<Client> findByTenantIdAndEmail(
      @Param("tenantId") Long tenantId, @Param("email") String email);

  @Query(
      "SELECT c FROM Client c WHERE c.tenant.id = :tenantId AND c.ruc = :ruc AND c.ruc IS NOT NULL")
  Optional<Client> findByTenantIdAndRuc(@Param("tenantId") Long tenantId, @Param("ruc") String ruc);

  long deleteByTenant_Id(Long tenantId);

  /**
   * Issue #216: per active client, the most recent {@code COMPLETED} appointment's {@code startAt}
   * (or {@code null} when the client never had one) — the raw data the "Panel de clientes
   * inactivos" dashboard widget is built from. Filtering/sorting/limiting by days of inactivity
   * happens in {@code DashboardService}, since that requires the tenant's timezone ("today") which
   * isn't available to a JPQL query.
   */
  interface InactiveClientRow {
    Long getClientId();

    String getFullName();

    String getPhone();

    Instant getLastCompletedVisit();
  }

  @Query(
      """
      SELECT c.id AS clientId, c.fullName AS fullName, c.phone AS phone,
             MAX(a.startAt) AS lastCompletedVisit
      FROM Client c
      LEFT JOIN Appointment a ON a.client = c AND a.status = :completedStatus
      WHERE c.tenant.id = :tenantId AND c.active = true
      GROUP BY c.id, c.fullName, c.phone
      """)
  List<InactiveClientRow> findActiveClientsWithLastCompletedVisit(
      @Param("tenantId") Long tenantId,
      @Param("completedStatus") AppointmentStatus completedStatus);
}
