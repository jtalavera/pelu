package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.CashSession;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CashSessionRepository extends JpaRepository<CashSession, Long> {

  Optional<CashSession> findFirstByTenant_IdAndClosedAtIsNullOrderByOpenedAtDesc(Long tenantId);

  Optional<CashSession> findByIdAndTenant_Id(Long id, Long tenantId);
}
