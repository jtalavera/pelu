package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.CashMovement;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CashMovementRepository extends JpaRepository<CashMovement, Long> {

  List<CashMovement> findByCashSession_IdAndTenant_IdOrderByCreatedAtAsc(
      Long cashSessionId, Long tenantId);

  long deleteByTenant_Id(Long tenantId);
}
