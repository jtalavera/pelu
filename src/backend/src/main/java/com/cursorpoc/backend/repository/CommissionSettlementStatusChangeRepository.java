package com.cursorpoc.backend.repository;

import com.cursorpoc.backend.domain.CommissionSettlementStatusChange;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CommissionSettlementStatusChangeRepository
    extends JpaRepository<CommissionSettlementStatusChange, Long> {

  List<CommissionSettlementStatusChange> findBySettlementIdOrderByChangedAtAscIdAsc(
      long settlementId);
}
