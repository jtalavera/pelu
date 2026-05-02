package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.FiscalStamp;
import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface FiscalStampRepository extends JpaRepository<FiscalStamp, Long> {

  List<FiscalStamp> findByTenant_IdOrderByIdAsc(Long tenantId);

  Optional<FiscalStamp> findByTenant_IdAndActiveTrue(Long tenantId);

  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("SELECT f FROM FiscalStamp f WHERE f.id = :id AND f.tenant.id = :tenantId")
  Optional<FiscalStamp> lockByIdAndTenantId(@Param("id") Long id, @Param("tenantId") Long tenantId);

  long countByTenant_Id(Long tenantId);
}
