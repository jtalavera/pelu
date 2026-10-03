package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.StockTenantLink;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface StockTenantLinkRepository extends JpaRepository<StockTenantLink, Long> {

  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("SELECT l FROM StockTenantLink l WHERE l.tenantId = :tenantId")
  Optional<StockTenantLink> lockByTenantId(@Param("tenantId") Long tenantId);
}
